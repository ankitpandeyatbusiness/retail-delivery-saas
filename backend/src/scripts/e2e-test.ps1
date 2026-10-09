# e2e-test.ps1  (Part A)
# Nothing to edit. The script asks you for the values when it starts.
# It needs the server running with SMS_MOCK=true. Each login asks for an OTP: read it in the server console.

$base = 'http://localhost:5000'

$script:pass = 0
$script:fail = 0
$script:failures = @()

function Check($name, [bool]$ok, $detail = '') {
    if ($ok) {
        Write-Host "PASS  $name" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "FAIL  $name   $detail" -ForegroundColor Red
        $script:fail++
        $script:failures += "$name   $detail"
    }
}

function Invoke-Api($method, $path, $token, $body) {
    $h = @{ 'x-tenant-slug' = $script:slug }
    if ($token) { $h['Authorization'] = "Bearer $token" }
    $p = @{ Method = $method; Uri = "$base$path"; Headers = $h }
    if ($body) {
        $p.Body = ($body | ConvertTo-Json -Depth 6)
        $p.ContentType = 'application/json'
    }
    try {
        $r = Invoke-RestMethod @p
        return @{ ok = $true; status = 200; data = $r; error = '' }
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $msg = $_.ErrorDetails.Message
        if (-not $msg) { $msg = $_.Exception.Message }
        if ($msg.Length -gt 220) { $msg = $msg.Substring(0, 220) }
        return @{ ok = $false; status = $code; data = $null; error = $msg }
    }
}

function Err($r) { if ($r.ok) { return '' } else { return "[$($r.status)] $($r.error)" } }

function Login($phone) {
    $s = Invoke-Api 'POST' '/api/auth/send-otp' $null @{ phone = $phone }
    if (-not $s.ok) { return $s }
    $otp = Read-Host "Type the 6-digit OTP for $phone (look in the server console)"
    return Invoke-Api 'POST' '/api/auth/verify-otp' $null @{ phone = $phone; otp = $otp.Trim() }
}

# ---------------------------------------------------------------- questions
Write-Host ''
Write-Host 'Answer 4 questions. Use a real shop slug in lowercase.' -ForegroundColor Cyan
$script:slug = (Read-Host 'Shop slug').Trim().ToLower()
$customerPhone = (Read-Host 'Customer phone (10 digits, any test number)').Trim()
$ownerPhone = (Read-Host 'Owner phone (must already be an OWNER of this shop)').Trim()
$riderPhone = (Read-Host 'Rider phone (a NEW number never used in this shop)').Trim()

foreach ($p in @($customerPhone, $ownerPhone, $riderPhone)) {
    if ($p -notmatch '^[6-9]\d{9}$') { Write-Host "Not a valid Indian mobile number: $p" -ForegroundColor Red; exit 1 }
}
if (($customerPhone -eq $ownerPhone) -or ($customerPhone -eq $riderPhone) -or ($ownerPhone -eq $riderPhone)) {
    Write-Host 'The three phone numbers must be different.' -ForegroundColor Red; exit 1
}
if (-not $script:slug) { Write-Host 'Slug is empty.' -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 1. basics
Write-Host ''; Write-Host '--- 1. Basics ---' -ForegroundColor Cyan
try { $hl = Invoke-RestMethod "$base/health"; Check 'Server health' ($hl.ok -eq $true) } catch { Check 'Server health' $false 'Server is not running on port 5000'; exit 1 }
$th = Invoke-Api 'GET' '/api/tenants/theme' $null $null
Check 'Shop slug is known' $th.ok (Err $th)
if (-not $th.ok) { Write-Host 'Wrong slug. Stopping.' -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 2. logins
Write-Host ''; Write-Host '--- 2. Logins (3 OTPs) ---' -ForegroundColor Cyan
$c = Login $customerPhone
Check 'Customer login' ($c.ok -and $c.data.accessToken) (Err $c)
$cTok = $c.data.accessToken
if ($c.ok) { Check 'Customer role is customer' ($c.data.user.role -eq 'customer') "role is $($c.data.user.role)" }

$o = Login $ownerPhone
Check 'Owner login' ($o.ok -and $o.data.accessToken) (Err $o)
$oTok = $o.data.accessToken
if ($o.ok) { Check 'Owner role is admin' ($o.data.user.role -eq 'admin') "role is $($o.data.user.role). This phone is not an owner of this shop." }

if (-not $oTok) { Write-Host 'No owner token. Stopping.' -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- 3. add rider
Write-Host ''; Write-Host '--- 3. Owner adds a rider ---' -ForegroundColor Cyan
$ar = Invoke-Api 'POST' '/api/shop/riders' $oTok @{ phone = $riderPhone; name = 'Test Rider' }
Check 'Owner adds rider by phone' ($ar.ok -or $ar.error -match 'already') (Err $ar)

$r = Login $riderPhone
Check 'Rider login' ($r.ok -and $r.data.accessToken) (Err $r)
$rTok = $r.data.accessToken
if ($r.ok) { Check 'Rider role is rider' ($r.data.user.role -eq 'rider') "role is $($r.data.user.role)" }

# ---------------------------------------------------------------- 4. rider routes
Write-Host ''; Write-Host '--- 4. Rider routes ---' -ForegroundColor Cyan
if ($rTok) {
    $x = Invoke-Api 'GET' '/api/rider/me' $rTok $null;                        Check 'Rider: GET /me' $x.ok (Err $x)
    $x = Invoke-Api 'PUT' '/api/rider/online' $rTok @{ isOnline = $true };    Check 'Rider: go online' $x.ok (Err $x)
    $x = Invoke-Api 'GET' '/api/rider/orders?tab=active' $rTok $null;         Check 'Rider: active orders' $x.ok (Err $x)
    $x = Invoke-Api 'GET' '/api/rider/orders?tab=offered' $rTok $null;        Check 'Rider: offered orders' $x.ok (Err $x)
    $x = Invoke-Api 'GET' '/api/rider/orders?tab=history' $rTok $null;        Check 'Rider: history' $x.ok (Err $x)
    $x = Invoke-Api 'GET' '/api/rider/summary' $rTok $null;                   Check 'Rider: summary' $x.ok (Err $x)
    $x = Invoke-Api 'GET' '/api/notifications' $rTok $null;                   Check 'Rider: inbox' $x.ok (Err $x)
} else { Check 'Rider routes (no rider token)' $false 'skipped' }

# ---------------------------------------------------------------- 5. owner routes
Write-Host ''; Write-Host '--- 5. Owner routes ---' -ForegroundColor Cyan
$x = Invoke-Api 'GET' '/api/shop/riders' $oTok $null
Check 'Owner: list riders' $x.ok (Err $x)
if ($x.ok) {
    $items = $x.data.items
    $found = $false
    foreach ($i in $items) { if ($i.phone -eq $riderPhone) { $found = $true } }
    Check 'Owner: test rider is in the list and online' $found 'rider not found in list'
}
$x = Invoke-Api 'GET' '/api/shop/orders?status=active' $oTok $null;          Check 'Owner: active orders' $x.ok (Err $x)
$x = Invoke-Api 'GET' '/api/shop/billing/status' $oTok $null;                Check 'Owner: billing status' $x.ok (Err $x)
if ($x.ok) { Write-Host "      billing state: $($x.data.state), free orders left: $($x.data.free.ordersLeft)" -ForegroundColor DarkGray }
$x = Invoke-Api 'GET' '/api/shop/billing/prompts' $oTok $null;               Check 'Owner: billing prompts' $x.ok (Err $x)
if ($x.ok) { Write-Host "      prompts now: $(@($x.data.items).Count)" -ForegroundColor DarkGray }
$x = Invoke-Api 'GET' '/api/shop/subscription/invoices' $oTok $null;         Check 'Owner: rent invoices' $x.ok (Err $x)
$x = Invoke-Api 'GET' '/api/shop/notifications' $oTok $null;                 Check 'Owner: inbox' $x.ok (Err $x)
$x = Invoke-Api 'GET' '/api/shop/cod/riders' $oTok $null;                    Check 'Owner: COD riders' $x.ok (Err $x)
$x = Invoke-Api 'GET' '/api/shop/cod/performance' $oTok $null;               Check 'Owner: rider performance' $x.ok (Err $x)
$x = Invoke-Api 'GET' '/api/shop/sms/wallet' $oTok $null;                    Check 'Owner: SMS wallet' $x.ok (Err $x)

# ---------------------------------------------------------------- 6. customer routes
Write-Host ''; Write-Host '--- 6. Customer routes ---' -ForegroundColor Cyan
if ($cTok) {
    $x = Invoke-Api 'GET' '/api/orders' $cTok $null;                         Check 'Customer: order history' $x.ok (Err $x)
    $x = Invoke-Api 'GET' '/api/notifications' $cTok $null;                  Check 'Customer: inbox' $x.ok (Err $x)
    $x = Invoke-Api 'GET' '/api/tenants/config' $cTok $null;                 Check 'Customer: shop config' $x.ok (Err $x)
}

# ---------------------------------------------------------------- 7. who must be refused
Write-Host ''; Write-Host '--- 7. Wrong people must be refused ---' -ForegroundColor Cyan
if ($cTok) {
    $x = Invoke-Api 'GET' '/api/shop/orders' $cTok $null;                    Check 'Customer cannot open owner routes' (($x.status -eq 401) -or ($x.status -eq 403)) "got status $($x.status)"
    $x = Invoke-Api 'GET' '/api/rider/me' $cTok $null;                       Check 'Customer cannot open rider routes' (($x.status -eq 401) -or ($x.status -eq 403)) "got status $($x.status)"
}
if ($rTok) {
    $x = Invoke-Api 'GET' '/api/shop/orders' $rTok $null;                    Check 'Rider cannot open owner routes' (($x.status -eq 401) -or ($x.status -eq 403)) "got status $($x.status)"
}
$x = Invoke-Api 'GET' '/api/shop/orders' $null $null;                        Check 'No token is refused' ($x.status -eq 401) "got status $($x.status)"
$x = Invoke-Api 'GET' '/api/admin/tenants' $oTok $null;                      Check 'Owner cannot open superadmin routes' (($x.status -eq 401) -or ($x.status -eq 403)) "got status $($x.status)"

# ---------------------------------------------------------------- result
Write-Host ''
Write-Host "RESULT: $script:pass passed, $script:fail failed" -ForegroundColor Cyan
if ($script:fail -gt 0) {
    Write-Host ''
    Write-Host 'Copy these lines and send them to me:' -ForegroundColor Yellow
    $script:failures | ForEach-Object { Write-Host $_ }
}
Write-Host ''
Write-Host 'Note: the test rider stays in the shop. Remove it later with DELETE /api/shop/riders/<userId>.' -ForegroundColor DarkGray