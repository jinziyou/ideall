#ifndef IDEALL_GPUI_IOS_H
#define IDEALL_GPUI_IOS_H

#include <stdbool.h>

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
void ideall_mobile_native_text_state(
    const char *value,
    unsigned long selection_start,
    unsigned long selection_end,
    bool composing
);
void ideall_ios_show_text_input(
    const char *value,
    unsigned long selection_start,
    unsigned long selection_end,
    int keyboard_type,
    bool multiline,
    bool secure,
    const char *label
);
void ideall_ios_update_text_selection(
    unsigned long selection_start,
    unsigned long selection_end
);
void ideall_ios_hide_text_input(void);
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
