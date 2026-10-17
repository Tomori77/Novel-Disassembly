# 生成 RP Disassembly 插件清单
# 用法：在项目根目录运行 powershell -File tools/build-plugins.ps1
# 扫描 plugins/*/plugin.json（跳过 _template），校验必填项后生成 plugins/index.js。

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir
$pluginsDir = Join-Path $root "plugins"
$outFile = Join-Path $pluginsDir "index.js"

if (-not (Test-Path -LiteralPath $pluginsDir)) {
  Write-Error "未找到插件目录：$pluginsDir"
  exit 1
}

$items = @()
$seen = @{}

$directories = Get-ChildItem -LiteralPath $pluginsDir -Directory | Sort-Object Name
foreach ($directory in $directories) {
  if ($directory.Name -eq "_template") { continue }

  $manifestPath = Join-Path $directory.FullName "plugin.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) { continue }

  try {
    $plugin = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    Write-Error "无法解析 $manifestPath：$($_.Exception.Message)"
    exit 1
  }

  $id = [string]$plugin.id
  $name = [string]$plugin.name
  $version = [string]$plugin.version
  $entry = [string]$plugin.entry
  $apiVersion = $plugin.apiVersion

  if ([string]::IsNullOrWhiteSpace($id)) {
    Write-Error "$manifestPath 缺少必填项 id"
    exit 1
  }
  if ($id -notmatch '^[a-z0-9][a-z0-9-]*$') {
    Write-Error "$manifestPath 的 id 只能使用小写字母、数字和连字符：$id"
    exit 1
  }
  if ($seen.ContainsKey($id)) {
    Write-Error "插件 id 重复：$id（$manifestPath）"
    exit 1
  }
  if ([string]::IsNullOrWhiteSpace($name)) {
    Write-Error "$manifestPath 缺少必填项 name"
    exit 1
  }
  if ([string]::IsNullOrWhiteSpace($version)) {
    Write-Error "$manifestPath 缺少必填项 version"
    exit 1
  }
  if ($null -eq $apiVersion -or [int]$apiVersion -ne 1) {
    Write-Error "$manifestPath 的 apiVersion 必须为 1"
    exit 1
  }
  if ([string]::IsNullOrWhiteSpace($entry)) {
    Write-Error "$manifestPath 缺少必填项 entry"
    exit 1
  }
  if ($entry -match '^[\\/]' -or ($entry -split '[\\/]') -contains '..' -or $entry -match '^[A-Za-z]:') {
    Write-Error "$manifestPath 的 entry 必须是插件目录内的相对路径：$entry"
    exit 1
  }
  $entryFile = Join-Path $directory.FullName ($entry -replace '/', '\')
  if (-not (Test-Path -LiteralPath $entryFile)) {
    Write-Error "$manifestPath 指向的入口文件不存在：$entry"
    exit 1
  }

  $enabled = $false
  if ($null -ne $plugin.enabled) { $enabled = [bool]$plugin.enabled }

  $priority = 100
  if ($null -ne $plugin.priority) {
    $parsed = 0
    if (-not [int]::TryParse([string]$plugin.priority, [ref]$parsed)) {
      Write-Error "$manifestPath 的 priority 必须是整数"
      exit 1
    }
    $priority = $parsed
  }

  $description = ""
  if ($null -ne $plugin.description) { $description = [string]$plugin.description }

  $seen[$id] = $true
  $items += [ordered]@{
    id          = $id
    name        = $name
    version     = $version
    apiVersion  = [int]$apiVersion
    entry       = $directory.Name + "/" + ($entry -replace '\\', '/')
    enabled     = $enabled
    priority    = $priority
    description = $description
  }
}

$sorted = @($items | Sort-Object -Property @{ Expression = { $_.priority } }, @{ Expression = { $_.id } })
if ($sorted.Count -eq 0) {
  $json = "[]"
} else {
  $json = ConvertTo-Json -InputObject $sorted -Depth 5
}

$content = "// 由 tools/build-plugins.ps1 自动生成，请勿手工修改。`r`n" +
  "window.RP_PLUGIN_INDEX = " + $json + ";`r`n"

[System.IO.File]::WriteAllText($outFile, $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ("已生成 " + $outFile + "（" + $sorted.Count + " 个插件）")
$sorted | ForEach-Object { Write-Host ("  - " + $_.id + " v" + $_.version + " enabled=" + $_.enabled + " priority=" + $_.priority) }
