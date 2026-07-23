#ifndef IDEALL_GPUI_IOS_H
#define IDEALL_GPUI_IOS_H

#ifdef __cplusplus
extern "C" {
#endif

void gpui_ios_register_app(void);
void gpui_ios_run_demo(void);
void *gpui_ios_get_window(void);
void gpui_ios_request_frame(void *window_ptr);
void gpui_ios_will_enter_foreground(void *app_ptr);
void gpui_ios_did_become_active(void *app_ptr);
void gpui_ios_will_resign_active(void *app_ptr);
void gpui_ios_did_enter_background(void *app_ptr);
void gpui_ios_will_terminate(void *app_ptr);
void gpui_ios_handle_open_url(void *url_ptr);
int ideall_copy_security_scoped_file(
    const char *source,
    const char *destination,
    unsigned long long max_bytes
);
char *ideall_pick_files(void);
void ideall_free_string(char *value);

#ifdef __cplusplus
}
#endif

#endif
