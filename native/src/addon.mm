// native/src/addon.mm — N-API bridge: JS ↔ C ABI (GhosttyBridge.swift)
#import <AppKit/AppKit.h>
#import <napi.h>
#include <string>

extern "C" {
    bool ghostty_bridge_setup_window(void* nsWindow, long browserWindowId);
    void ghostty_bridge_set_overlay_active(void* nsWindow, bool active);
    bool ghostty_bridge_create_terminal(void* nsWindow, const char* panelId,
                                         double x, double y, double w, double h);
    void ghostty_bridge_set_frame(const char* panelId,
                                   double x, double y, double w, double h);
    void ghostty_bridge_show(const char* panelId);
    void ghostty_bridge_hide(const char* panelId);
    void ghostty_bridge_close(const char* panelId);
    void ghostty_bridge_focus(const char* panelId);
    void ghostty_bridge_close_all(void* nsWindow);
    void ghostty_bridge_detach_window(void* nsWindow);
    // C 函数指针 typedef 让 swift cb 能传给 N-API ThreadSafeFunction 持有的 trampoline.
    // 签名: (browserWindowId, modifierFlags, chars UTF-8). browserWindowId 是 Electron
    // BrowserWindow.id, 让 main 端按 window id 路由 (多窗口下 getFocusedWindow 不准).
    typedef void (*KeyboardForwardFn)(long browserWindowId, unsigned long modifiers, const char* chars);
    void ghostty_bridge_set_keyboard_forward_callback(KeyboardForwardFn cb);
    typedef void (*MouseForwardFn)(long browserWindowId, const char* panelId, double x, double y);
    void ghostty_bridge_set_mouse_forward_callback(MouseForwardFn cb);
    void ghostty_bridge_set_active_panel_kind(void* nsWindow, long kindRaw, const char* panelId);
}

// Electron getNativeWindowHandle() returns Buffer containing NSView**
static NSWindow* WindowFromHandle(const Napi::Value& v) {
    Napi::Buffer<char> buf = v.As<Napi::Buffer<char>>();
    void* raw = static_cast<void*>(buf.Data());
    NSView* __unsafe_unretained * viewPtr =
        reinterpret_cast<NSView* __unsafe_unretained *>(raw);
    NSView* view = *viewPtr;
    return view.window;
}

// --- JS exports ---

static Napi::Value JsSetupWindow(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return Napi::Boolean::New(info.Env(), false);
    long browserWindowId = static_cast<long>(info[1].As<Napi::Number>().Int64Value());
    bool ok = ghostty_bridge_setup_window((__bridge void*)win, browserWindowId);
    return Napi::Boolean::New(info.Env(), ok);
}

static Napi::Value JsSetOverlayActive(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    bool active = info[1].As<Napi::Boolean>().Value();
    ghostty_bridge_set_overlay_active((__bridge void*)win, active);
    return info.Env().Undefined();
}

static Napi::Value JsCreateTerminal(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return Napi::Boolean::New(info.Env(), false);
    std::string panelId = info[1].As<Napi::String>().Utf8Value();
    Napi::Object frame = info[2].As<Napi::Object>();
    double x = frame.Get("x").As<Napi::Number>().DoubleValue();
    double y = frame.Get("y").As<Napi::Number>().DoubleValue();
    double w = frame.Get("width").As<Napi::Number>().DoubleValue();
    double h = frame.Get("height").As<Napi::Number>().DoubleValue();
    bool ok = ghostty_bridge_create_terminal((__bridge void*)win, panelId.c_str(), x, y, w, h);
    return Napi::Boolean::New(info.Env(), ok);
}

static Napi::Value JsSetFrame(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    Napi::Object frame = info[1].As<Napi::Object>();
    double x = frame.Get("x").As<Napi::Number>().DoubleValue();
    double y = frame.Get("y").As<Napi::Number>().DoubleValue();
    double w = frame.Get("width").As<Napi::Number>().DoubleValue();
    double h = frame.Get("height").As<Napi::Number>().DoubleValue();
    ghostty_bridge_set_frame(panelId.c_str(), x, y, w, h);
    return info.Env().Undefined();
}

static Napi::Value JsShow(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_show(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsHide(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_hide(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsClose(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_close(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsFocus(const Napi::CallbackInfo& info) {
    std::string panelId = info[0].As<Napi::String>().Utf8Value();
    ghostty_bridge_focus(panelId.c_str());
    return info.Env().Undefined();
}

static Napi::Value JsCloseAll(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    ghostty_bridge_close_all((__bridge void*)win);
    return info.Env().Undefined();
}

static Napi::Value JsDetachWindow(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    ghostty_bridge_detach_window((__bridge void*)win);
    return info.Env().Undefined();
}

// ---- Keyboard forward callback (swift → main JS) ----
//
// swift NSEvent monitor 捕获 Cmd+key 时, 通过 C 函数指针 (g_keyForwardTrampoline)
// 调到这里, 我们通过 ThreadSafeFunction 把事件分发到 main 进程的 JS 线程, 让 JS
// 端注册的 callback 收到 { modifiers, chars }.
//
// 不能直接在 swift 线程调 napi function (会 crash) — ThreadSafeFunction 是 N-API
// 标准的跨线程 callback 桥.
static Napi::ThreadSafeFunction g_keyboardTSFN;

struct KeyForwardPayload {
    long windowId;
    unsigned long modifiers;
    std::string chars;  // heap-owned (跨线程持久化)
};

static void g_keyForwardTrampoline(long windowId, unsigned long modifiers, const char* chars) {
    if (!g_keyboardTSFN) return;
    auto* payload = new KeyForwardPayload{ windowId, modifiers, std::string(chars) };
    auto status = g_keyboardTSFN.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, KeyForwardPayload* p) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(p->windowId)),
            Napi::Number::New(env, static_cast<double>(p->modifiers)),
            Napi::String::New(env, p->chars),
        });
        delete p;
    });
    if (status != napi_ok) {
        delete payload;
    }
}

static Napi::Value JsSetKeyboardForwardCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() == 0 || info[0].IsNull() || info[0].IsUndefined()) {
        if (g_keyboardTSFN) {
            g_keyboardTSFN.Release();
            g_keyboardTSFN = Napi::ThreadSafeFunction();
        }
        ghostty_bridge_set_keyboard_forward_callback(nullptr);
        return env.Undefined();
    }
    Napi::Function jsFn = info[0].As<Napi::Function>();
    if (g_keyboardTSFN) g_keyboardTSFN.Release();
    g_keyboardTSFN = Napi::ThreadSafeFunction::New(env, jsFn, "PierKeyForward", 0, 1);
    ghostty_bridge_set_keyboard_forward_callback(&g_keyForwardTrampoline);
    return env.Undefined();
}

// ---- Right-mouse forward callback (swift → main JS) ----
//
// 同 keyboard forward 模式: swift NSEvent monitor 命中 terminal 区域右键时调
// trampoline, ThreadSafeFunction 把 (windowId, panelId, x, y) 转到 JS 线程.
static Napi::ThreadSafeFunction g_mouseTSFN;

struct MouseForwardPayload {
    long windowId;
    std::string panelId;
    double x;
    double y;
};

static void g_mouseForwardTrampoline(long windowId, const char* panelId, double x, double y) {
    if (!g_mouseTSFN) return;
    auto* payload = new MouseForwardPayload{ windowId, std::string(panelId), x, y };
    auto status = g_mouseTSFN.BlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, MouseForwardPayload* p) {
        jsCallback.Call({
            Napi::Number::New(env, static_cast<double>(p->windowId)),
            Napi::String::New(env, p->panelId),
            Napi::Number::New(env, p->x),
            Napi::Number::New(env, p->y),
        });
        delete p;
    });
    if (status != napi_ok) {
        delete payload;
    }
}

static Napi::Value JsSetMouseForwardCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() == 0 || info[0].IsNull() || info[0].IsUndefined()) {
        if (g_mouseTSFN) {
            g_mouseTSFN.Release();
            g_mouseTSFN = Napi::ThreadSafeFunction();
        }
        ghostty_bridge_set_mouse_forward_callback(nullptr);
        return env.Undefined();
    }
    Napi::Function jsFn = info[0].As<Napi::Function>();
    if (g_mouseTSFN) g_mouseTSFN.Release();
    g_mouseTSFN = Napi::ThreadSafeFunction::New(env, jsFn, "PierMouseForward", 0, 1);
    ghostty_bridge_set_mouse_forward_callback(&g_mouseForwardTrampoline);
    return env.Undefined();
}

static Napi::Value JsSetActivePanelKind(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    long kindRaw = static_cast<long>(info[1].As<Napi::Number>().Int64Value());
    const char* panelIdC = nullptr;
    std::string panelIdHolder;
    if (info.Length() > 2 && info[2].IsString()) {
        panelIdHolder = info[2].As<Napi::String>().Utf8Value();
        panelIdC = panelIdHolder.c_str();
    }
    ghostty_bridge_set_active_panel_kind((__bridge void*)win, kindRaw, panelIdC);
    return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("setupWindow",     Napi::Function::New(env, JsSetupWindow));
    exports.Set("setOverlayActive", Napi::Function::New(env, JsSetOverlayActive));
    exports.Set("createTerminal",  Napi::Function::New(env, JsCreateTerminal));
    exports.Set("setFrame",        Napi::Function::New(env, JsSetFrame));
    exports.Set("showTerminal",    Napi::Function::New(env, JsShow));
    exports.Set("hideTerminal",    Napi::Function::New(env, JsHide));
    exports.Set("closeTerminal",   Napi::Function::New(env, JsClose));
    exports.Set("focusTerminal",   Napi::Function::New(env, JsFocus));
    exports.Set("closeAllTerminals", Napi::Function::New(env, JsCloseAll));
    exports.Set("detachWindow",    Napi::Function::New(env, JsDetachWindow));
    exports.Set("setKeyboardForwardCallback", Napi::Function::New(env, JsSetKeyboardForwardCallback));
    exports.Set("setActivePanelKind", Napi::Function::New(env, JsSetActivePanelKind));
    exports.Set("setMouseForwardCallback", Napi::Function::New(env, JsSetMouseForwardCallback));
    return exports;
}

NODE_API_MODULE(ghostty_native, Init)
