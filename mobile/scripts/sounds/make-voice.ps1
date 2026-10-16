# Step 1 of making the new-order sound: records the phrase "New order received" with a Windows voice.
#
#   powershell -File mobile/scripts/sounds/make-voice.ps1 -Out voice.wav [-Voice Heera]
#
# Heera (Indian English, female) and Ravi (Indian English, male) are Windows voices; they are listed with
#   [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
# Step 2 is make-sounds.js, which turns this recording into assets/sounds/new_order.wav.
param(
    [string]$Out = 'voice.wav',
    [string]$Voice = 'Heera',
    [string]$Phrase = 'New order received'
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like "*$Voice*" } | Select-Object -First 1
if (-not $v) { throw "No Windows voice named '$Voice'. Installed: " + (([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object { $_.DisplayName }) -join ', ') }
$synth.Voice = $v

$stream = Await ($synth.SynthesizeTextToStreamAsync($Phrase)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$size = [int]$stream.Size
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
[void](Await ($reader.LoadAsync($size)) ([uint32]))
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes((Join-Path (Get-Location) $Out), $bytes)
"Recorded '$Phrase' with $($v.DisplayName) -> $Out ($size bytes)"
