#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <node_api.h>

#include <cstdint>
#include <string>

namespace {

enum class HandleKind { Job, Process };

struct HandleBox {
  HANDLE value;
  HandleKind kind;
};

void ThrowLastError(napi_env env, const char* operation) {
  const DWORD code = GetLastError();
  std::string message(operation);
  message.append(" failed with Windows error ");
  message.append(std::to_string(code));
  napi_throw_error(env, nullptr, message.c_str());
}

HandleBox* GetHandle(napi_env env, napi_value value, HandleKind expected) {
  void* data = nullptr;
  if (napi_get_value_external(env, value, &data) != napi_ok || data == nullptr) {
    napi_throw_type_error(env, nullptr, "expected an opaque Windows handle");
    return nullptr;
  }
  auto* box = static_cast<HandleBox*>(data);
  if (box->kind != expected || box->value == nullptr) {
    napi_throw_error(env, nullptr, "Windows handle is closed or has the wrong kind");
    return nullptr;
  }
  return box;
}

void FinalizeHandle(napi_env, void* data, void*) {
  auto* box = static_cast<HandleBox*>(data);
  if (box->value != nullptr) {
    CloseHandle(box->value);
  }
  delete box;
}

napi_value WrapHandle(napi_env env, HANDLE handle, HandleKind kind) {
  napi_value result;
  auto* box = new HandleBox{handle, kind};
  if (napi_create_external(env, box, FinalizeHandle, nullptr, &result) != napi_ok) {
    CloseHandle(handle);
    delete box;
    napi_throw_error(env, nullptr, "failed to create opaque Windows handle");
    return nullptr;
  }
  return result;
}

napi_value CreateJob(napi_env env, napi_callback_info) {
  HANDLE job = CreateJobObjectW(nullptr, nullptr);
  if (job == nullptr) {
    ThrowLastError(env, "CreateJobObjectW");
    return nullptr;
  }
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits,
                               sizeof(limits))) {
    ThrowLastError(env, "SetInformationJobObject");
    CloseHandle(job);
    return nullptr;
  }
  return WrapHandle(env, job, HandleKind::Job);
}

napi_value OpenProcessHandle(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t pid = 0;
  if (argc != 1 || napi_get_value_uint32(env, argv[0], &pid) != napi_ok) {
    napi_throw_type_error(env, nullptr, "openProcess requires a process id");
    return nullptr;
  }
  constexpr DWORD rights = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA |
                           PROCESS_TERMINATE | SYNCHRONIZE;
  HANDLE process = OpenProcess(rights, FALSE, pid);
  if (process == nullptr) {
    ThrowLastError(env, "OpenProcess");
    return nullptr;
  }
  return WrapHandle(env, process, HandleKind::Process);
}

napi_value AssignProcess(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc != 2) {
    napi_throw_type_error(env, nullptr, "assignProcess requires job and process handles");
    return nullptr;
  }
  HandleBox* job = GetHandle(env, argv[0], HandleKind::Job);
  HandleBox* process = GetHandle(env, argv[1], HandleKind::Process);
  if (job == nullptr || process == nullptr) {
    return nullptr;
  }
  if (!AssignProcessToJobObject(job->value, process->value)) {
    ThrowLastError(env, "AssignProcessToJobObject");
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value QueryActiveProcesses(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  HandleBox* job = argc == 1 ? GetHandle(env, argv[0], HandleKind::Job) : nullptr;
  if (job == nullptr) {
    return nullptr;
  }
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (!QueryInformationJobObject(job->value, JobObjectBasicAccountingInformation,
                                 &accounting, sizeof(accounting), nullptr)) {
    ThrowLastError(env, "QueryInformationJobObject");
    return nullptr;
  }
  napi_value result;
  napi_create_uint32(env, accounting.ActiveProcesses, &result);
  return result;
}

napi_value TerminateJob(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  HandleBox* job = argc == 1 ? GetHandle(env, argv[0], HandleKind::Job) : nullptr;
  if (job == nullptr) {
    return nullptr;
  }
  if (!TerminateJobObject(job->value, 1)) {
    ThrowLastError(env, "TerminateJobObject");
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

struct TerminateWork {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  HANDLE process = nullptr;
  DWORD timeout = 0;
  DWORD error = ERROR_SUCCESS;
};

void ExecuteTerminate(napi_env, void* data) {
  auto* work = static_cast<TerminateWork*>(data);
  if (!TerminateProcess(work->process, 1)) {
    const DWORD error = GetLastError();
    if (error != ERROR_ACCESS_DENIED) {
      work->error = error;
      return;
    }
  }
  const DWORD wait = WaitForSingleObject(work->process, work->timeout);
  if (wait == WAIT_TIMEOUT) {
    work->error = WAIT_TIMEOUT;
  } else if (wait == WAIT_FAILED) {
    work->error = GetLastError();
  }
}

void CompleteTerminate(napi_env env, napi_status status, void* data) {
  auto* work = static_cast<TerminateWork*>(data);
  CloseHandle(work->process);
  if (status == napi_ok && work->error == ERROR_SUCCESS) {
    napi_value undefined;
    napi_get_undefined(env, &undefined);
    napi_resolve_deferred(env, work->deferred, undefined);
  } else {
    const DWORD code = work->error;
    std::string message = code == WAIT_TIMEOUT
                              ? "TerminateProcess wait timed out"
                              : "TerminateProcessAndWait failed with Windows error " +
                                    std::to_string(code);
    napi_value text;
    napi_value error;
    napi_create_string_utf8(env, message.c_str(), NAPI_AUTO_LENGTH, &text);
    napi_create_error(env, nullptr, text, &error);
    napi_reject_deferred(env, work->deferred, error);
  }
  napi_delete_async_work(env, work->work);
  delete work;
}

napi_value TerminateProcessAndWait(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  HandleBox* process = argc == 2 ? GetHandle(env, argv[0], HandleKind::Process) : nullptr;
  uint32_t timeout = 0;
  if (process == nullptr || napi_get_value_uint32(env, argv[1], &timeout) != napi_ok) {
    if (process != nullptr) {
      napi_throw_type_error(env, nullptr, "timeout must be an unsigned integer");
    }
    return nullptr;
  }
  HANDLE duplicate = nullptr;
  if (!DuplicateHandle(GetCurrentProcess(), process->value, GetCurrentProcess(),
                       &duplicate, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
    ThrowLastError(env, "DuplicateHandle");
    return nullptr;
  }
  auto* work = new TerminateWork{};
  work->process = duplicate;
  work->timeout = timeout;
  napi_value promise;
  napi_create_promise(env, &work->deferred, &promise);
  napi_value resource_name;
  napi_create_string_utf8(env, "lspTerminateProcessAndWait", NAPI_AUTO_LENGTH,
                          &resource_name);
  if (napi_create_async_work(env, nullptr, resource_name, ExecuteTerminate,
                             CompleteTerminate, work, &work->work) != napi_ok ||
      napi_queue_async_work(env, work->work) != napi_ok) {
    CloseHandle(duplicate);
    delete work;
    napi_throw_error(env, nullptr, "failed to queue process termination");
    return nullptr;
  }
  return promise;
}

napi_value CloseOpaqueHandle(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  void* data = nullptr;
  if (argc != 1 || napi_get_value_external(env, argv[0], &data) != napi_ok ||
      data == nullptr) {
    napi_throw_type_error(env, nullptr, "close requires an opaque Windows handle");
    return nullptr;
  }
  auto* box = static_cast<HandleBox*>(data);
  if (box->value != nullptr) {
    CloseHandle(box->value);
    box->value = nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"createJob", nullptr, CreateJob, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"openProcess", nullptr, OpenProcessHandle, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"assignProcess", nullptr, AssignProcess, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"queryActiveProcesses", nullptr, QueryActiveProcesses, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"terminateJob", nullptr, TerminateJob, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"terminateProcessAndWait", nullptr, TerminateProcessAndWait, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"close", nullptr, CloseOpaqueHandle, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
