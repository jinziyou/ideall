#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#include <dispatch/dispatch.h>
#include <stdlib.h>
#include <string.h>
#import "gpui_ios.h"

@interface IdeallAppDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic, strong) CADisplayLink *displayLink;
@property(nonatomic, assign) void *gpuiWindow;
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

@implementation IdeallAppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    gpui_ios_register_app();
    gpui_ios_run_demo();
    self.gpuiWindow = gpui_ios_get_window();
    if (self.gpuiWindow != NULL) {
        self.displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(renderFrame)];
        [self.displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
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
            UIWindow *window = UIApplication.sharedApplication.keyWindow;
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
