#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <dispatch/dispatch.h>
#include <stdlib.h>
#include <string.h>
#import "gpui_ios.h"

@interface IdeallAppDelegate : UIResponder <UIApplicationDelegate, UITextViewDelegate>
@property(nonatomic, strong) CADisplayLink *displayLink;
@property(nonatomic, assign) void *gpuiWindow;
@property(nonatomic, strong) UITextView *textInputBridge;
@property(nonatomic, assign) BOOL updatingTextInputBridge;
@property(nonatomic, assign) BOOL textInputBridgeMultiline;
@end

@interface IdeallDocumentPickerDelegate : NSObject <UIDocumentPickerDelegate>
@property(nonatomic, strong) NSArray<NSURL *> *URLs;
@property(nonatomic, strong) dispatch_semaphore_t semaphore;
@end

@implementation IdeallDocumentPickerDelegate

- (void)documentPicker:(UIDocumentPickerViewController *)controller
    didPickDocumentsAtURLs:(NSArray<NSURL *> *)URLs {
    self.URLs = URLs;
    [controller dismissViewControllerAnimated:YES completion:nil];
    dispatch_semaphore_signal(self.semaphore);
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
    self.URLs = @[];
    [controller dismissViewControllerAnimated:YES completion:nil];
    dispatch_semaphore_signal(self.semaphore);
}

@end

static __weak IdeallAppDelegate *IdeallSharedDelegate = nil;

static UIWindow *IdeallKeyWindow(void) {
    UIWindow *fallback = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) continue;
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            if (fallback == nil) fallback = window;
            if (window.isKeyWindow) return window;
        }
    }
    return fallback;
}

static NSUInteger IdeallUTF16OffsetForUTF8(const char *value, NSUInteger byteOffset) {
    if (value == NULL) return 0;
    NSUInteger length = strlen(value);
    byteOffset = MIN(byteOffset, length);
    NSString *prefix = nil;
    while (prefix == nil && byteOffset > 0) {
        prefix = [[NSString alloc] initWithBytes:value
                                         length:byteOffset
                                       encoding:NSUTF8StringEncoding];
        if (prefix == nil) byteOffset -= 1;
    }
    return prefix.length;
}

static NSUInteger IdeallUTF8OffsetForUTF16(NSString *value, NSUInteger utf16Offset) {
    utf16Offset = MIN(utf16Offset, value.length);
    NSString *prefix = nil;
    while (prefix == nil && utf16Offset > 0) {
        NSRange range = NSMakeRange(0, utf16Offset);
        prefix = [value substringWithRange:range];
        if ([prefix dataUsingEncoding:NSUTF8StringEncoding] == nil) {
            prefix = nil;
            utf16Offset -= 1;
        }
    }
    return [prefix ?: @"" lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
}

@implementation IdeallAppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    IdeallSharedDelegate = self;
    ideall_ios_register_host_callbacks(
        ideall_ios_show_text_input,
        ideall_ios_update_text_selection,
        ideall_ios_hide_text_input,
        ideall_copy_security_scoped_file,
        ideall_pick_files,
        ideall_free_string
    );
    gpui_ios_register_app();
    gpui_ios_run_demo();
    self.gpuiWindow = gpui_ios_get_window();
    if (self.gpuiWindow != NULL) {
        self.displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(renderFrame)];
        [self.displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    }
    return YES;
}

- (void)installTextInputBridgeIfNeeded {
    if (self.textInputBridge != nil) return;
    UIWindow *window = IdeallKeyWindow();
    UIViewController *controller = window.rootViewController;
    if (controller == nil) return;

    UITextView *input = [[UITextView alloc] initWithFrame:CGRectMake(0, 0, 2, 2)];
    input.delegate = self;
    input.backgroundColor = UIColor.clearColor;
    input.textColor = UIColor.clearColor;
    input.tintColor = UIColor.clearColor;
    input.alpha = 0.02;
    input.autocorrectionType = UITextAutocorrectionTypeDefault;
    input.autocapitalizationType = UITextAutocapitalizationTypeSentences;
    input.spellCheckingType = UITextSpellCheckingTypeDefault;
    input.accessibilityHint = @"编辑后内容会自动保存在本机";
    input.accessibilityTraits = UIAccessibilityTraitUpdatesFrequently;
    input.accessibilityFrame = CGRectMake(0, 0, 44, 44);
    [controller.view addSubview:input];
    self.textInputBridge = input;
}

- (void)sendTextInputBridgeState {
    if (self.updatingTextInputBridge || self.textInputBridge == nil) return;
    NSString *value = self.textInputBridge.text ?: @"";
    NSRange selection = self.textInputBridge.selectedRange;
    NSUInteger start = IdeallUTF8OffsetForUTF16(value, selection.location);
    NSUInteger end = IdeallUTF8OffsetForUTF16(
        value,
        NSMaxRange(selection)
    );
    ideall_mobile_native_text_state(
        value.UTF8String ?: "",
        start,
        end,
        self.textInputBridge.markedTextRange != nil
    );
}

- (void)showTextInputBridge:(NSString *)value
             selectionStart:(NSUInteger)selectionStart
               selectionEnd:(NSUInteger)selectionEnd
               keyboardType:(NSInteger)keyboardType
                  multiline:(BOOL)multiline
                      secure:(BOOL)secure
                       label:(NSString *)label {
    [self installTextInputBridgeIfNeeded];
    UITextView *input = self.textInputBridge;
    if (input == nil) return;

    self.updatingTextInputBridge = YES;
    self.textInputBridgeMultiline = multiline;
    input.accessibilityLabel = label.length > 0 ? label : @"文本输入";
    input.secureTextEntry = secure;
    switch (keyboardType) {
        case 1: input.keyboardType = UIKeyboardTypeEmailAddress; break;
        case 2: input.keyboardType = UIKeyboardTypePhonePad; break;
        case 3: input.keyboardType = UIKeyboardTypeNumberPad; break;
        case 4: input.keyboardType = UIKeyboardTypeURL; break;
        case 5: input.keyboardType = UIKeyboardTypeDecimalPad; break;
        default: input.keyboardType = UIKeyboardTypeDefault; break;
    }
    input.returnKeyType = multiline ? UIReturnKeyDefault : UIReturnKeyDone;
    input.autocorrectionType =
        secure || keyboardType == 4
            ? UITextAutocorrectionTypeNo
            : UITextAutocorrectionTypeDefault;
    input.autocapitalizationType =
        secure || keyboardType == 4
            ? UITextAutocapitalizationTypeNone
            : UITextAutocapitalizationTypeSentences;
    input.text = value ?: @"";
    const char *utf8 = input.text.UTF8String ?: "";
    NSUInteger start = IdeallUTF16OffsetForUTF8(utf8, selectionStart);
    NSUInteger end = IdeallUTF16OffsetForUTF8(utf8, selectionEnd);
    start = MIN(start, input.text.length);
    end = MIN(MAX(end, start), input.text.length);
    input.selectedRange = NSMakeRange(start, end - start);
    self.updatingTextInputBridge = NO;
    [input reloadInputViews];
    [input becomeFirstResponder];
    UIAccessibilityPostNotification(UIAccessibilityLayoutChangedNotification, input);
}

- (void)updateTextInputBridgeSelectionFromByteStart:(NSUInteger)selectionStart
                                            byteEnd:(NSUInteger)selectionEnd {
    UITextView *input = self.textInputBridge;
    if (input == nil) return;
    self.updatingTextInputBridge = YES;
    const char *utf8 = input.text.UTF8String ?: "";
    NSUInteger start = IdeallUTF16OffsetForUTF8(utf8, selectionStart);
    NSUInteger end = IdeallUTF16OffsetForUTF8(utf8, selectionEnd);
    start = MIN(start, input.text.length);
    end = MIN(MAX(end, start), input.text.length);
    input.selectedRange = NSMakeRange(start, end - start);
    self.updatingTextInputBridge = NO;
}

- (void)textViewDidChange:(UITextView *)textView {
    [self sendTextInputBridgeState];
}

- (void)textViewDidChangeSelection:(UITextView *)textView {
    [self sendTextInputBridgeState];
}

- (BOOL)textView:(UITextView *)textView
    shouldChangeTextInRange:(NSRange)range
           replacementText:(NSString *)text {
    if (!self.textInputBridgeMultiline &&
        [text rangeOfCharacterFromSet:[NSCharacterSet newlineCharacterSet]].location != NSNotFound) {
        [textView resignFirstResponder];
        return NO;
    }
    return YES;
}

- (void)renderFrame {
    if (self.gpuiWindow != NULL) gpui_ios_request_frame(self.gpuiWindow);
}

- (void)applicationWillEnterForeground:(UIApplication *)application {
    gpui_ios_will_enter_foreground(NULL);
    if (self.displayLink == nil && self.gpuiWindow != NULL) {
        self.displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(renderFrame)];
        [self.displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    }
}

- (void)applicationDidBecomeActive:(UIApplication *)application {
    gpui_ios_did_become_active(NULL);
}

- (void)applicationWillResignActive:(UIApplication *)application {
    [self.textInputBridge endEditing:YES];
    [self sendTextInputBridgeState];
    gpui_ios_will_resign_active(NULL);
}

- (void)applicationDidEnterBackground:(UIApplication *)application {
    gpui_ios_did_enter_background(NULL);
    [self.displayLink invalidate];
    self.displayLink = nil;
}

- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary *)options {
    gpui_ios_handle_open_url((__bridge void *)url.absoluteString);
    return YES;
}

- (void)applicationWillTerminate:(UIApplication *)application {
    [self.displayLink invalidate];
    gpui_ios_will_terminate(NULL);
}

@end

void ideall_ios_show_text_input(
    const char *value,
    unsigned long selectionStart,
    unsigned long selectionEnd,
    int keyboardType,
    bool multiline,
    bool secure,
    const char *label
) {
    NSString *text = value == NULL ? @"" : [NSString stringWithUTF8String:value];
    NSString *accessibilityLabel =
        label == NULL ? @"文本输入" : [NSString stringWithUTF8String:label];
    dispatch_async(dispatch_get_main_queue(), ^{
        [IdeallSharedDelegate showTextInputBridge:text ?: @""
                                  selectionStart:(NSUInteger)selectionStart
                                    selectionEnd:(NSUInteger)selectionEnd
                                    keyboardType:(NSInteger)keyboardType
                                       multiline:multiline
                                           secure:secure
                                            label:accessibilityLabel ?: @"文本输入"];
    });
}

void ideall_ios_update_text_selection(
    unsigned long selectionStart,
    unsigned long selectionEnd
) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [IdeallSharedDelegate
            updateTextInputBridgeSelectionFromByteStart:(NSUInteger)selectionStart
                                                byteEnd:(NSUInteger)selectionEnd];
    });
}

void ideall_ios_hide_text_input(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [IdeallSharedDelegate.textInputBridge resignFirstResponder];
    });
}

int ideall_copy_security_scoped_file(
    const char *source,
    const char *destination,
    unsigned long long maxBytes
) {
    @autoreleasepool {
        if (source == NULL || destination == NULL) return 1;
        NSString *sourceText = [NSString stringWithUTF8String:source];
        NSString *destinationText = [NSString stringWithUTF8String:destination];
        if (sourceText == nil || destinationText == nil) return 1;

        NSURL *sourceURL = nil;
        if ([sourceText hasPrefix:@"file:"]) {
            sourceURL = [NSURL URLWithString:sourceText];
        } else if ([sourceText hasPrefix:@"/"]) {
            NSString *urlText = [@"file://" stringByAppendingString:sourceText];
            sourceURL = [NSURL URLWithString:urlText];
        }
        if (sourceURL == nil) return 1;

        BOOL scoped = [sourceURL startAccessingSecurityScopedResource];
        NSInputStream *input = [NSInputStream inputStreamWithURL:sourceURL];
        NSOutputStream *output = [NSOutputStream outputStreamToFileAtPath:destinationText append:NO];
        if (input == nil || output == nil) {
            if (scoped) [sourceURL stopAccessingSecurityScopedResource];
            return 2;
        }

        [[NSFileManager defaultManager] removeItemAtPath:destinationText error:NULL];
        [input open];
        [output open];
        uint8_t buffer[64 * 1024];
        unsigned long long total = 0;
        int result = 0;
        while (true) {
            NSInteger count = [input read:buffer maxLength:sizeof(buffer)];
            if (count == 0) break;
            if (count < 0) {
                result = 4;
                break;
            }
            total += (unsigned long long)count;
            if (total > maxBytes) {
                result = 3;
                break;
            }
            NSInteger offset = 0;
            while (offset < count) {
                NSInteger written = [output write:buffer + offset maxLength:(NSUInteger)(count - offset)];
                if (written <= 0) {
                    result = 4;
                    break;
                }
                offset += written;
            }
            if (result != 0) break;
        }
        [input close];
        [output close];
        if (scoped) [sourceURL stopAccessingSecurityScopedResource];
        if (result != 0) {
            [[NSFileManager defaultManager] removeItemAtPath:destinationText error:NULL];
        }
        return result;
    }
}

char *ideall_pick_files(void) {
    @autoreleasepool {
        // Rust always invokes this blocking bridge on GPUI's background executor.
        if ([NSThread isMainThread]) return NULL;
        __block IdeallDocumentPickerDelegate *delegate =
            [[IdeallDocumentPickerDelegate alloc] init];
        delegate.semaphore = dispatch_semaphore_create(0);
        __block BOOL presented = NO;
        dispatch_sync(dispatch_get_main_queue(), ^{
            UIWindow *window = IdeallKeyWindow();
            UIViewController *controller = window.rootViewController;
            if (controller == nil) return;
            UIDocumentPickerViewController *picker =
                [[UIDocumentPickerViewController alloc]
                    initForOpeningContentTypes:@[UTTypeItem]];
            picker.allowsMultipleSelection = YES;
            picker.delegate = delegate;
            [controller presentViewController:picker animated:YES completion:nil];
            presented = YES;
        });
        if (!presented) return NULL;
        dispatch_semaphore_wait(delegate.semaphore, DISPATCH_TIME_FOREVER);

        NSMutableArray<NSDictionary *> *files = [NSMutableArray array];
        for (NSURL *URL in delegate.URLs ?: @[]) {
            NSString *path = URL.absoluteString;
            NSString *name = URL.lastPathComponent;
            if (path != nil && name != nil) {
                [files addObject:@{@"path": path, @"name": name}];
            }
        }
        NSData *JSON = [NSJSONSerialization dataWithJSONObject:files options:0 error:NULL];
        if (JSON == nil) return NULL;
        char *result = malloc(JSON.length + 1);
        if (result == NULL) return NULL;
        memcpy(result, JSON.bytes, JSON.length);
        result[JSON.length] = '\0';
        return result;
    }
}

void ideall_free_string(char *value) {
    free(value);
}

int main(int argc, char *argv[]) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, nil, NSStringFromClass([IdeallAppDelegate class]));
    }
}
