# Git 审阅测试夹具

Git 审阅测试在系统临时目录动态创建真实仓库，不提交包含平台相关索引格式的二进制夹具。

覆盖范围包括：

- unborn 与 root commit；
- staged、unstaged、untracked、rename 和 branch merge-base；
- staged `a→b`、unstaged `b→c` 的一对一 rename 链，以及不得合并的 copy 边；
- Tab、换行、前导短横线及 `:(glob)` 路径；
- raw/porcelain/numstat 多段 NUL 记录与非法 UTF-8 字节；
- 2,000/2,001 个逻辑文件、预算和取消边界。

所有临时仓库在测试结束后删除；测试不得读取 diff 正文来推导索引元数据。
