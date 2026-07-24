//! Pure mobile editor transformations and cursor helpers.

use unicode_segmentation::UnicodeSegmentation as _;

pub(crate) fn control_sequence(key: &str) -> Option<&'static str> {
    match key {
        "backspace" => Some("\u{8}"),
        "delete" => Some("\u{1b}[3~"),
        "left" => Some("\u{1b}[D"),
        "right" => Some("\u{1b}[C"),
        "home" => Some("\u{1b}[H"),
        "end" => Some("\u{1b}[F"),
        "enter" => Some("\n"),
        _ => None,
    }
}

pub(crate) fn enqueue_control_key(
    pending: &mut Vec<String>,
    observed_pending_chunks: &mut usize,
    key: &str,
) -> bool {
    let Some(sequence) = control_sequence(key) else {
        return false;
    };
    let delivered_by_platform = pending.len() > *observed_pending_chunks
        && pending.last().is_some_and(|chunk| chunk == sequence);
    if !delivered_by_platform {
        pending.push(sequence.to_owned());
    }
    *observed_pending_chunks = pending.len();
    !delivered_by_platform
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BlockStyle {
    Paragraph,
    Heading1,
    Heading2,
    Quote,
    Bullet,
    Ordered,
    Todo,
    Code,
    Rule,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BlockMove {
    Up,
    Down,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BlockFormatError {
    ProtectedBlock,
    CodeBlock,
}

const SLASH_COMMANDS: &[(&str, &str, &[&str], BlockStyle)] = &[
    (
        "paragraph",
        "正文",
        &["p", "text", "正文"],
        BlockStyle::Paragraph,
    ),
    (
        "heading-1",
        "标题 1",
        &["h1", "heading1", "标题1"],
        BlockStyle::Heading1,
    ),
    (
        "heading-2",
        "标题 2",
        &["h2", "heading2", "标题2"],
        BlockStyle::Heading2,
    ),
    (
        "quote",
        "引用",
        &["quote", "blockquote", "引用"],
        BlockStyle::Quote,
    ),
    (
        "bullet",
        "项目列表",
        &["ul", "bullet", "list", "项目"],
        BlockStyle::Bullet,
    ),
    (
        "ordered",
        "编号列表",
        &["ol", "ordered", "number", "编号"],
        BlockStyle::Ordered,
    ),
    ("todo", "任务", &["todo", "task", "任务"], BlockStyle::Todo),
    ("code", "代码块", &["code", "代码"], BlockStyle::Code),
    (
        "rule",
        "分隔线",
        &["hr", "rule", "divider", "分隔线"],
        BlockStyle::Rule,
    ),
];

pub(crate) fn slash_query(target: &str, cursor: usize) -> Option<&str> {
    let mut cursor = cursor.min(target.len());
    while cursor > 0 && !target.is_char_boundary(cursor) {
        cursor -= 1;
    }
    let line_start = target[..cursor].rfind('\n').map_or(0, |index| index + 1);
    let before_cursor = &target[line_start..cursor];
    let query = before_cursor.strip_prefix('/')?;
    (!query.chars().any(char::is_whitespace)).then_some(query)
}

pub(crate) fn slash_commands(query: &str) -> Vec<(&'static str, &'static str, BlockStyle)> {
    let query = query.to_lowercase();
    SLASH_COMMANDS
        .iter()
        .filter(|(_, label, aliases, _)| {
            query.is_empty()
                || label.to_lowercase().contains(&query)
                || aliases.iter().any(|alias| alias.contains(&query))
        })
        .map(|(id, label, _, style)| (*id, *label, *style))
        .collect()
}

pub(crate) fn apply_slash_command(
    target: &mut String,
    cursor: &mut usize,
    style: BlockStyle,
) -> Result<bool, BlockFormatError> {
    if slash_query(target, *cursor).is_none() {
        return Ok(false);
    }
    let line_start = target[..*cursor].rfind('\n').map_or(0, |index| index + 1);
    let line_end = target[*cursor..]
        .find('\n')
        .map_or(target.len(), |offset| *cursor + offset);
    target.replace_range(line_start..line_end, "");
    *cursor = line_start;
    apply_block_style(target, cursor, style)?;
    Ok(true)
}

pub(crate) fn move_block(
    target: &mut String,
    cursor: &mut usize,
    direction: BlockMove,
) -> Option<bool> {
    *cursor = (*cursor).min(target.len());
    while *cursor > 0 && !target.is_char_boundary(*cursor) {
        *cursor -= 1;
    }
    let ranges = block_ranges(target)?;
    let current = ranges
        .iter()
        .position(|(start, end)| *start <= *cursor && *cursor <= *end)?;
    let destination = match direction {
        BlockMove::Up => current.checked_sub(1),
        BlockMove::Down => (current + 1 < ranges.len()).then_some(current + 1),
    };
    let Some(destination) = destination else {
        return Some(false);
    };

    let relative_cursor = cursor.saturating_sub(ranges[current].0);
    let mut blocks = ranges
        .iter()
        .map(|(start, end)| target[*start..*end].to_owned())
        .collect::<Vec<_>>();
    blocks.swap(current, destination);
    let new_block_start = blocks
        .iter()
        .take(destination)
        .map(|block| block.len() + 1)
        .sum::<usize>();
    *target = blocks.join("\n");
    *cursor = (new_block_start + relative_cursor).min(target.len());
    Some(true)
}

fn block_ranges(target: &str) -> Option<Vec<(usize, usize)>> {
    let mut lines = Vec::new();
    let mut offset = 0;
    for line in target.split('\n') {
        lines.push((offset, offset + line.len(), line));
        offset += line.len() + 1;
    }

    let mut ranges = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let (start, mut end, line) = lines[index];
        if line.starts_with("```") {
            index += 1;
            let mut closed = false;
            while index < lines.len() {
                end = lines[index].1;
                if lines[index].2 == "```" {
                    index += 1;
                    closed = true;
                    break;
                }
                index += 1;
            }
            if !closed {
                return None;
            }
        } else if line.starts_with("> ") {
            index += 1;
            while index < lines.len() && lines[index].2.starts_with("> ") {
                end = lines[index].1;
                index += 1;
            }
        } else {
            index += 1;
        }
        ranges.push((start, end));
    }
    Some(ranges)
}

pub(crate) fn apply_block_style(
    target: &mut String,
    cursor: &mut usize,
    style: BlockStyle,
) -> Result<bool, BlockFormatError> {
    const PROTECTED_PREFIX: &str = "⟦ideall:受保护块:";

    *cursor = (*cursor).min(target.len());
    while *cursor > 0 && !target.is_char_boundary(*cursor) {
        *cursor -= 1;
    }
    let line_start = target[..*cursor].rfind('\n').map_or(0, |index| index + 1);
    let line_end = target[*cursor..]
        .find('\n')
        .map_or(target.len(), |offset| *cursor + offset);
    let line = &target[line_start..line_end];
    if line.trim_start().starts_with(PROTECTED_PREFIX) {
        return Err(BlockFormatError::ProtectedBlock);
    }

    let before_line = &target[..line_start];
    let inside_code_fence = before_line
        .split('\n')
        .filter(|line| line.trim_start().starts_with("```"))
        .count()
        % 2
        == 1;
    if inside_code_fence || line.trim_start().starts_with("```") {
        return Err(BlockFormatError::CodeBlock);
    }

    let (indent, content_start) = block_content_start(line);
    let content = &line[content_start..];
    let content_cursor = cursor
        .saturating_sub(line_start + content_start)
        .min(content.len());
    let prefix = match style {
        BlockStyle::Paragraph => "",
        BlockStyle::Heading1 => "# ",
        BlockStyle::Heading2 => "## ",
        BlockStyle::Quote => "> ",
        BlockStyle::Bullet => "- ",
        BlockStyle::Ordered => "1. ",
        BlockStyle::Todo => "- [ ] ",
        BlockStyle::Code | BlockStyle::Rule => "",
    };
    let keep_indent = matches!(
        style,
        BlockStyle::Bullet | BlockStyle::Ordered | BlockStyle::Todo
    );
    let indentation = if keep_indent { indent } else { "" };
    let replacement = match style {
        BlockStyle::Code => format!("```\n{content}\n```"),
        BlockStyle::Rule => "---".to_owned(),
        _ => format!("{indentation}{prefix}{content}"),
    };
    if replacement == line {
        return Ok(false);
    }

    let new_cursor = match style {
        BlockStyle::Code => line_start + "```\n".len() + content_cursor,
        BlockStyle::Rule => line_start + replacement.len(),
        _ => line_start + indentation.len() + prefix.len() + content_cursor,
    };
    target.replace_range(line_start..line_end, &replacement);
    *cursor = new_cursor.min(target.len());
    Ok(true)
}

fn block_content_start(line: &str) -> (&str, usize) {
    let indentation_len = line.len() - line.trim_start_matches(' ').len();
    let indentation = &line[..indentation_len];
    let value = &line[indentation_len..];

    let heading_len = value.bytes().take_while(|byte| *byte == b'#').count();
    if (1..=6).contains(&heading_len) && value.as_bytes().get(heading_len) == Some(&b' ') {
        return (indentation, indentation_len + heading_len + 1);
    }
    if let Some(rest) = value.strip_prefix("> ") {
        return (indentation, line.len() - rest.len());
    }
    for prefix in ["- [ ] ", "- [x] ", "- [X] ", "- ", "* "] {
        if let Some(rest) = value.strip_prefix(prefix) {
            return (indentation, line.len() - rest.len());
        }
    }
    if let Some((number, rest)) = value.split_once(". ")
        && !number.is_empty()
        && number.bytes().all(|byte| byte.is_ascii_digit())
    {
        return (indentation, line.len() - rest.len());
    }
    if value == "---" {
        return (indentation, line.len());
    }
    (indentation, indentation_len)
}

#[cfg(test)]
pub(crate) fn apply_input(target: &mut String, chunk: &str, multiline: bool) -> bool {
    let mut cursor = target.len();
    apply_input_at_cursor(target, &mut cursor, chunk, multiline)
}

pub(crate) fn apply_input_at_cursor(
    target: &mut String,
    cursor: &mut usize,
    chunk: &str,
    multiline: bool,
) -> bool {
    if chunk.is_empty() {
        return false;
    }
    *cursor = (*cursor).min(target.len());
    while *cursor > 0 && !target.is_char_boundary(*cursor) {
        *cursor -= 1;
    }
    match chunk {
        "\u{1b}[D" => {
            if let Some((start, _)) = target[..*cursor].grapheme_indices(true).next_back() {
                *cursor = start;
            }
            return false;
        }
        "\u{1b}[C" => {
            *cursor = target[*cursor..]
                .grapheme_indices(true)
                .nth(1)
                .map(|(offset, _)| *cursor + offset)
                .unwrap_or(target.len());
            return false;
        }
        "\u{1b}[H" => {
            *cursor = 0;
            return false;
        }
        "\u{1b}[F" => {
            *cursor = target.len();
            return false;
        }
        "\u{7f}" | "\u{1b}[3~" => {
            if let Some((next, _)) = target[*cursor..].grapheme_indices(true).nth(1) {
                target.replace_range(*cursor..*cursor + next, "");
                return true;
            }
            if *cursor < target.len() {
                target.truncate(*cursor);
                return true;
            }
            return false;
        }
        _ => {}
    }
    if chunk.chars().all(|character| character == '\u{8}') {
        let mut changed = false;
        for _ in chunk.chars() {
            let Some((start, _)) = target[..*cursor].grapheme_indices(true).next_back() else {
                break;
            };
            target.replace_range(start..*cursor, "");
            *cursor = start;
            changed = true;
        }
        return changed;
    }

    let insertion = if multiline {
        chunk.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        chunk
            .chars()
            .filter(|character| !matches!(character, '\r' | '\n'))
            .collect()
    };
    if insertion.is_empty() {
        false
    } else {
        target.insert_str(*cursor, &insertion);
        *cursor += insertion.len();
        true
    }
}

pub(crate) fn text_line_ranges(text: &str) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    let mut start = 0;
    for segment in text.split_inclusive('\n') {
        let end = start + segment.trim_end_matches('\n').len();
        ranges.push(start..end);
        start += segment.len();
    }
    if text.is_empty() || text.ends_with('\n') {
        ranges.push(text.len()..text.len());
    }
    ranges
}

pub(crate) fn cursor_line_index(text: &str, cursor: usize) -> usize {
    let cursor = cursor.min(text.len());
    let ranges = text_line_ranges(text);
    ranges
        .iter()
        .position(|range| cursor <= range.end)
        .unwrap_or_else(|| ranges.len().saturating_sub(1))
}

pub(crate) fn line_with_cursor(line: &str, offset: usize) -> String {
    let mut offset = offset.min(line.len());
    while offset > 0 && !line.is_char_boundary(offset) {
        offset -= 1;
    }
    let mut display = String::with_capacity(line.len() + "▏".len());
    display.push_str(&line[..offset]);
    display.push('▏');
    display.push_str(&line[offset..]);
    display
}

pub(crate) fn native_edit_committed(
    value_changed: bool,
    was_composing: bool,
    is_composing: bool,
) -> bool {
    !is_composing && (value_changed || was_composing)
}
