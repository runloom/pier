#include <napi.h>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

namespace {
struct Publication {
    int directory = -1;
    int temporary = -1;
    char name[64] = {};

    ~Publication() {
        if (directory >= 0 && temporary >= 0 && name[0] != '\0') {
            struct stat owned, entry;
            if (fstat(temporary, &owned) == 0 &&
                fstatat(directory, name, &entry, AT_SYMLINK_NOFOLLOW) == 0 &&
                S_ISREG(entry.st_mode) && entry.st_dev == owned.st_dev && entry.st_ino == owned.st_ino) {
                unlinkat(directory, name, 0);
            }
        }
        if (temporary >= 0) close(temporary);
        if (directory >= 0) close(directory);
    }
};

bool MatchesFile(const struct stat& value, const std::string& expected) {
    char identity[256];
    const auto mtime = static_cast<long long>(value.st_mtimespec.tv_sec) * 1000000000LL + value.st_mtimespec.tv_nsec;
    const auto ctime = static_cast<long long>(value.st_ctimespec.tv_sec) * 1000000000LL + value.st_ctimespec.tv_nsec;
    const int length = std::snprintf(identity, sizeof(identity), "%llu:%llu:%llu:%llu:%lld:%lld",
        static_cast<unsigned long long>(value.st_dev), static_cast<unsigned long long>(value.st_ino),
        static_cast<unsigned long long>(value.st_mode), static_cast<unsigned long long>(value.st_size), mtime, ctime);
    return S_ISREG(value.st_mode) && length >= 0 && static_cast<size_t>(length) == expected.size() &&
        std::memcmp(identity, expected.data(), expected.size()) == 0;
}

bool MatchesDirectory(const struct stat& value, const std::string& expected) {
    char identity[64];
    const int length = std::snprintf(identity, sizeof(identity), "%llu:%llu",
        static_cast<unsigned long long>(value.st_dev), static_cast<unsigned long long>(value.st_ino));
    return S_ISDIR(value.st_mode) && length >= 0 && static_cast<size_t>(length) == expected.size() &&
        std::memcmp(identity, expected.data(), expected.size()) == 0;
}

bool MatchesCandidate(const struct stat& value, const struct stat& expected) {
    return S_ISREG(value.st_mode) && value.st_dev == expected.st_dev && value.st_ino == expected.st_ino &&
        value.st_mode == expected.st_mode && value.st_uid == expected.st_uid && value.st_gid == expected.st_gid &&
        value.st_size == expected.st_size &&
        value.st_mtimespec.tv_sec == expected.st_mtimespec.tv_sec &&
        value.st_mtimespec.tv_nsec == expected.st_mtimespec.tv_nsec &&
        value.st_ctimespec.tv_sec == expected.st_ctimespec.tv_sec &&
        value.st_ctimespec.tv_nsec == expected.st_ctimespec.tv_nsec;
}

int VerifyCandidateContents(int candidate, const uint8_t* expected, size_t length) {
    uint8_t buffer[64 * 1024];
    size_t offset = 0;
    while (offset < length) {
        const size_t remaining = length - offset;
        const size_t requested = remaining < sizeof(buffer) ? remaining : sizeof(buffer);
        const ssize_t count = pread(candidate, buffer, requested, static_cast<off_t>(offset));
        if (count < 0) {
            if (errno == EINTR) continue;
            return errno;
        }
        if (count == 0 || std::memcmp(buffer, expected + offset, static_cast<size_t>(count)) != 0) return ESTALE;
        offset += static_cast<size_t>(count);
    }
    return 0;
}

int Publish(int source, const std::string& parent, const std::string& name,
            const uint8_t* bytes, size_t length, const std::string& expected,
            const std::string& parentIdentity) {
    if (name.empty() || name == "." || name == ".." || name.find('/') != std::string::npos ||
        name.find('\0') != std::string::npos || parent.find('\0') != std::string::npos) return EINVAL;
    Publication publication;
    publication.directory = open(parent.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW_ANY);
    if (publication.directory < 0) return errno;
    struct stat directory, original;
    if (fstat(publication.directory, &directory) != 0 || fstat(source, &original) != 0) return errno;
    if (!MatchesDirectory(directory, parentIdentity) || !MatchesFile(original, expected)) return ESTALE;
    for (int attempt = 0; attempt < 8; ++attempt) {
        std::snprintf(publication.name, sizeof(publication.name), ".pier-conflict-%d-%08x.tmp", getpid(), arc4random());
        publication.temporary = openat(publication.directory, publication.name,
            O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
        if (publication.temporary >= 0) break;
        if (errno != EEXIST) {
            publication.name[0] = '\0';
            return errno;
        }
        // Never unlink a colliding file owned by another publication.
        publication.name[0] = '\0';
    }
    if (publication.temporary < 0) return EEXIST;
    size_t written = 0;
    while (written < length) {
        const ssize_t count = write(publication.temporary, bytes + written, length - written);
        if (count < 0) {
            if (errno == EINTR) continue;
            return errno;
        }
        if (count == 0) return EIO;
        written += static_cast<size_t>(count);
    }
    struct stat candidate;
    if (fchown(publication.temporary, original.st_uid, original.st_gid) != 0 ||
        fchmod(publication.temporary, original.st_mode & 07777) != 0 ||
        fstat(publication.temporary, &candidate) != 0 || fsync(publication.temporary) != 0) return errno;
    struct stat beforeContents;
    if (fstat(publication.temporary, &beforeContents) != 0) return errno;
    if (!MatchesCandidate(beforeContents, candidate) || candidate.st_mode != original.st_mode ||
        candidate.st_uid != original.st_uid || candidate.st_gid != original.st_gid ||
        static_cast<uint64_t>(candidate.st_size) != length) return ESTALE;
    const int contentsResult = VerifyCandidateContents(publication.temporary, bytes, length);
    if (contentsResult != 0) return contentsResult;

    // Reopen the textual parent with the kernel's all-ancestor symlink fence.
    // The rename itself uses the held directory descriptor, never a path lookup.
    const int currentParent = open(parent.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW_ANY);
    if (currentParent < 0) return errno;
    const int statResult = fstat(currentParent, &directory);
    const int statError = errno;
    close(currentParent);
    if (statResult != 0) return statError;
    if (!MatchesDirectory(directory, parentIdentity)) return ESTALE;
    struct stat target;
    if (fstat(source, &original) != 0 ||
        fstatat(publication.directory, name.c_str(), &target, AT_SYMLINK_NOFOLLOW) != 0) return errno;
    if (!MatchesFile(original, expected) || !MatchesFile(target, expected)) return ESTALE;
    struct stat currentCandidate, candidateEntry;
    if (fstat(publication.temporary, &currentCandidate) != 0 ||
        fstatat(publication.directory, publication.name, &candidateEntry, AT_SYMLINK_NOFOLLOW) != 0) return errno;
    if (!MatchesCandidate(currentCandidate, candidate) || !MatchesCandidate(candidateEntry, candidate)) return ESTALE;
    // These final observations are guards, not a kernel compare-and-swap with renameat.
    if (renameat(publication.directory, publication.name, publication.directory, name.c_str()) != 0) return errno;
    publication.name[0] = '\0';
    return 0;
}

Napi::Value ReplaceFileAtomically(const Napi::CallbackInfo& info) {
    const auto env = info.Env();
    if (info.Length() != 6 || !info[0].IsNumber() || !info[1].IsString() || !info[2].IsString() ||
        !info[3].IsBuffer() || !info[4].IsString() || !info[5].IsString()) {
        Napi::TypeError::New(env, "Invalid atomic file publication arguments").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const auto bytes = info[3].As<Napi::Buffer<uint8_t>>();
    const int result = Publish(info[0].As<Napi::Number>().Int32Value(), info[1].As<Napi::String>().Utf8Value(),
        info[2].As<Napi::String>().Utf8Value(), bytes.Data(), bytes.Length(),
        info[4].As<Napi::String>().Utf8Value(), info[5].As<Napi::String>().Utf8Value());
    return Napi::Number::New(env, result);
}
} // namespace

void RegisterAtomicFile(Napi::Env env, Napi::Object exports) {
    exports.Set("replaceFileAtomically", Napi::Function::New(env, ReplaceFileAtomically));
}
