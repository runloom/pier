{
  "targets": [
    {
      "target_name": "lsp_windows_job",
      "sources": ["src/addon.cc"],
      "conditions": [
        ["OS!='win'", { "type": "none" }]
      ]
    }
  ]
}
