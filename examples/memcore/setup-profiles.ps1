param(
  [Parameter(Mandatory = $true)]
  [string]$Harness,
  [string]$MemCoreSpec = 'github:Muredsa/dsh-memcore#v0.1.7',
  [string]$MemCoreBuildKey = 'dsh-memcore@https://codeload.github.com/Muredsa/dsh-memcore/tar.gz/8051adf56e553ed80b5bd6cab3174dda10b36e8b'
)

$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path $HOME '.dsh' } else { $env:DSH_HOME }
$baseline = Join-Path $dshHome 'profiles\headless'
$experiment = Join-Path $dshHome 'profiles\headless-memcore'

if (-not (Test-Path $baseline)) {
  Push-Location $Harness
  try { pnpm dsh plugin --profile headless add dsh-benchup } finally { Pop-Location }
}

if (-not (Test-Path $experiment)) {
  New-Item -ItemType Directory -Path $experiment | Out-Null
  foreach ($file in 'cordis.patch.yml', 'cordis.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml') {
    Copy-Item -LiteralPath (Join-Path $baseline $file) -Destination (Join-Path $experiment $file)
  }
}

# Git-hosted plugins run their prepare script while pnpm installs them.  Keep the
# allow-list local to this benchmark profile instead of changing the baseline.
$workspaceConfig = Join-Path $experiment 'pnpm-workspace.yaml'
if (-not (Select-String -LiteralPath $workspaceConfig -Pattern '^allowBuilds:' -Quiet)) {
  Add-Content -LiteralPath $workspaceConfig -Value "`nallowBuilds:`n  `"$MemCoreBuildKey`": true"
}

Push-Location $Harness
try { pnpm dsh plugin --profile headless-memcore add $MemCoreSpec } finally { Pop-Location }
