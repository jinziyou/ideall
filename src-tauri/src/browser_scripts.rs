// 内嵌浏览器 agent 脚本 (WebKit evaluate_script 与 CDP Page::evaluate 共用)。

pub const CONTENT_JS: &str = r#"
(function(){
  try {
    var t = (document.body && document.body.innerText) || '';
    return JSON.stringify({title: document.title || '', text: t.slice(0, 8000)});
  } catch(e) {
    return JSON.stringify({title: '', text: '', error: String(e)});
  }
})()
"#;

pub const LIST_INTERACTIVE_JS: &str = r#"
(function(){
  function vis(el){
    var r=el.getBoundingClientRect();
    return r.width>0&&r.height>0;
  }
  function esc(s){return String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');}
  function pickSel(el){
    var tag=el.tagName.toLowerCase();
    if(el.id&&/^[a-zA-Z][\w:-]*$/.test(el.id))return '#'+el.id;
    var n=el.getAttribute('name');
    if(n&&(tag==='input'||tag==='textarea'||tag==='select'))return tag+'[name="'+esc(n)+'"]';
    var al=el.getAttribute('aria-label');
    if(al)return '[aria-label="'+esc(al)+'"]';
    var ph=el.getAttribute('placeholder');
    if(ph&&(tag==='input'||tag==='textarea'))return tag+'[placeholder="'+esc(ph)+'"]';
    return '';
  }
  function label(el){
    var t=(el.innerText||el.value||'').trim();
    if(t)return t.slice(0,120);
    return (el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('name')||el.id||'').trim().slice(0,120);
  }
  var q='button,a[href],input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]';
  var nodes=document.querySelectorAll(q);
  var out=[],ref=1;
  for(var i=0;i<nodes.length&&out.length<50;i++){
    var el=nodes[i];
    if(!vis(el))continue;
    var sel=pickSel(el);
    if(!sel)continue;
    var tag=el.tagName.toLowerCase();
    var role=el.getAttribute('role')||tag;
    var typ=el.getAttribute('type')||'';
    out.push({ref:ref++,role:role,name:label(el),selector:sel,tag:tag,type:typ});
  }
  return JSON.stringify({url:location.href,title:document.title,elements:out});
})()
"#;

pub fn js_element_exists(selector: &str) -> Result<String, String> {
    let sel_json = serde_json::to_string(selector).map_err(|e| format!("selector-json: {e}"))?;
    Ok(format!(
        "(function(){{try{{return JSON.stringify({{ok:!!document.querySelector({sel_json})}});}}catch(e){{return JSON.stringify({{ok:false}});}}}})()"
    ))
}

pub fn js_click(selector: &str) -> Result<String, String> {
    let sel_json = serde_json::to_string(selector).map_err(|e| format!("selector-json: {e}"))?;
    Ok(format!(
        "(function(){{try{{var el=document.querySelector({sel_json});if(!el)return JSON.stringify({{ok:false,error:'not-found'}});el.click();return JSON.stringify({{ok:true}});}}catch(e){{return JSON.stringify({{ok:false,error:String(e)}});}}}})()"
    ))
}

pub fn js_press(key: &str) -> Result<String, String> {
    let key_json = serde_json::to_string(key).map_err(|e| format!("key-json: {e}"))?;
    Ok(format!(
        "(function(){{try{{var t=document.activeElement||document.body;t.dispatchEvent(new KeyboardEvent('keydown',{{key:{key_json},bubbles:true}}));t.dispatchEvent(new KeyboardEvent('keyup',{{key:{key_json},bubbles:true}}));return JSON.stringify({{ok:true}});}}catch(e){{return JSON.stringify({{ok:false,error:String(e)}});}}}})()"
    ))
}

pub fn js_fill(selector: &str, text: &str) -> Result<String, String> {
    let sel_json = serde_json::to_string(selector).map_err(|e| format!("selector-json: {e}"))?;
    let val_json = serde_json::to_string(text).map_err(|e| format!("text-json: {e}"))?;
    Ok(format!(
        "(function(){{try{{var el=document.querySelector({sel_json});if(!el)return JSON.stringify({{ok:false,error:'not-found'}});el.focus();if('value' in el)el.value={val_json};else el.textContent={val_json};el.dispatchEvent(new Event('input',{{bubbles:true}}));el.dispatchEvent(new Event('change',{{bubbles:true}}));return JSON.stringify({{ok:true}});}}catch(e){{return JSON.stringify({{ok:false,error:String(e)}});}}}})()"
    ))
}
