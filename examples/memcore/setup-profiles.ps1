param(
  [Parameter(Mandatory = $true)]
  [string]$Harness,
  [string]$MemCoreSpec = 'github:Muredsa/dsh-memcore#v0.1.6'
)

$dshHome = if ([string]::IsNullOrWhiteSpace($env:DSH_HOME)) { Join-Path $HOME '.dsh' } else { $env:DSH_HOME }
$baseline = Join-Path $dshHome 'profiles\headless'
$experiment = Join-Path $dshHome 'profiles\headless-memcore'

if (-not (Test-Path $baseline)) {
  Push-Location $Harness
  try { pnpm dsh plugin --profile headless add dsh-benchup } finally { Pop-Location }
}

if (-not (Test-Path $experiment)) { Copy-Item $baseline $experiment -Recurse }

Push-Location $Harness
try { pnpm dsh plugin --profile headless-memcore add $MemCoreSpec } finally { Pop-Location }
