# Generates strong local secrets for SOWEN. Do not commit the generated values.
function New-Secret([int]$bytes = 48) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToBase64String($buffer)
}

Write-Host "JWT_ACCESS_SECRET=$(New-Secret)"
Write-Host "JWT_REFRESH_SECRET=$(New-Secret)"
Write-Host "CRON_SECRET=$(New-Secret)"
