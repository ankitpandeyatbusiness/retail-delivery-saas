# e2e-test-b.ps1  (Part B: the real order and delivery flow)
# Run Part A first (it adds the test rider). Server must run with SMS_MOCK=true.
# If ENFORCE_NO_COD_IN_FREE=true is in your .env, set it to false first, or COD orders are refused.
# ASCII only on purpose, so copy and paste cannot break it.

$base = 'http://localhost:5000'
$script:pass = 0
$script:fail = 0
$script:failures = @()

function Check($name, [bool]$ok, $detail = '') {
    if ($ok) { Write-Host "PASS  $name" -ForegroundColor Green; $script:pass++ }
    else { Write-Host "FAIL  $name   $detail" -ForegroundColor Red; $script:fail++; $script:failures += "$name   $detail" }
}

function Invoke-Api($method, $path, $token, $body) {
    $h = @{ 'x-tenant-slug' = $script:slug }
    if ($token) { $h['Authorization'] = "Bearer $token" }
    $p = @{ Method = $method; Uri = "$base$path"; Headers = $h }
    if ($body) { $p.Body = ($body | ConvertTo-Json -Depth 8); $p.ContentType = 'application/json' }
    try {
        $r = Invoke-RestMethod @p
        return @{ ok = $true; status = 200; data = $r; error = '' }
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $msg = $_.ErrorDetails.Message
        if (-not $msg) { $msg = $_.Exception.Message }
        if ($msg.Length -gt 240) { $msg = $msg.Substring(0, 240) }
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

function Idof($o) { if ($o.id) { return [string]$o.id } else { return [string]$o._id } }

# walk any JSON and return the first product-like object (has price, an id, no required options)
function Find-Product($n) {
    if ($null -eq $n -or $n -is [string]) { return $null }
    if ($n -is [System.Collections.IEnumerable]) { foreach ($x in $n) { $r = Find-Product $x; if ($r) { return $r } }; return $null }
    $names = @($n.PSObject.Properties.Name)
    if (($names -contains 'price') -and (($names -contains '_id') -or ($names -contains 'id'))) {
        $groups = @(); if ($names -contains 'optionGroups') { $groups = @($n.optionGroups) }
        $needs = $false
        foreach ($g in $groups) { if ($g.min -ge 1) { $needs = $true } }
        if (-not $needs -and $n.isAvailable -ne $false -and [double]$n.price -gt 0) { return $n }
    }
    foreach ($pn in $names) { $r = Find-Product $n.$pn; if ($r) { return $r } }
    return $null
}

function Find-FirstId($n) {
    if ($null -eq $n -or $n -is [string]) { return $null }
    if ($n -is [System.Collections.IEnumerable]) { foreach ($x in $n) { $r = Find-FirstId $x; if ($r) { return $r } }; return $null }
    $names = @($n.PSObject.Properties.Name)
    if (($names -contains '_id') -or ($names -contains 'id')) { return (Idof $n) }
    foreach ($pn in $names) { $r = Find-FirstId $n.$pn; if ($r) { return $r } }
    return $null
}

function Text($x) { return ($x | ConvertTo-Json -Depth 8 -Compress) }

# ---------------------------------------------------------------- questions
Write-Host ''
Write-Host 'Answer 4 questions (same as Part A).' -ForegroundColor Cyan
$script:slug = (Read-Host 'Shop slug').Trim().ToLower()
$customerPhone = (Read-Host 'Customer phone (must have an address in this shop)').Trim()
$ownerPhone = (Read-Host 'Owner phone').Trim()
$riderPhone = (Read-Host 'Rider phone (the one from Part A)').Trim()

# ---------------------------------------------------------------- 1. logins
Write-Host ''; Write-Host '--- 1. Logins (3 OTPs) ---' -ForegroundColor Cyan
$c = Login $customerPhone; Check 'Customer login' ($c.ok -and $c.data.accessToken) (Err $c); $cTok = $c.data.accessToken
$o = Login $ownerPhone;    Check 'Owner login' ($o.ok -and $o.data.accessToken) (Err $o); $oTok = $o.data.accessToken
$r = Login $riderPhone;    Check 'Rider login' ($r.ok -and $r.data.accessToken) (Err $r); $rTok = $r.data.accessToken
if (-not ($cTok -and $oTok -and $rTok)) { Write-Host 'A login failed. Stopping.' -ForegroundColor Red; exit 1 }
if ($r.data.user.role -ne 'rider') { Write-Host 'This phone is not a rider. Run Part A first.' -ForegroundColor Red; exit 1 }

$me = Invoke-Api 'GET' '/api/rider/me' $rTok $null
Check 'Rider profile' $me.ok (Err $me)
$riderId = [string]$me.data.userId
$x = Invoke-Api 'PUT' '/api/rider/online' $rTok @{ isOnline = $true }
Check 'Rider goes online' $x.ok (Err $x)

# ---------------------------------------------------------------- 2. find a dish and an address
Write-Host ''; Write-Host '--- 2. Find a dish and an address ---' -ForegroundColor Cyan
$prod = $null
foreach ($pth in @('/api/products?limit=50', '/api/menu', '/api/products')) {
    $m = Invoke-Api 'GET' $pth $cTok $null
    if ($m.ok) { $prod = Find-Product $m.data; if ($prod) { Write-Host "      dish found through $pth" -ForegroundColor DarkGray; break } }
}
if ($prod) {
    $productId = Idof $prod
    $qty = [int][math]::Ceiling(200 / [double]$prod.price); if ($qty -gt 20) { $qty = 20 }
    Write-Host "      using: $($prod.name), price $($prod.price), quantity $qty" -ForegroundColor DarkGray
} else {
    Write-Host 'Could not find a dish by itself.' -ForegroundColor Yellow
    $productId = (Read-Host 'Paste any product id (a dish with no required option, e.g. Butter Naan)').Trim()
    $qty = [int](Read-Host 'Quantity to reach the minimum order (e.g. 4)')
}
$addressId = $null
foreach ($pth in @('/api/addresses', '/api/me/addresses')) {
    $a = Invoke-Api 'GET' $pth $cTok $null
    if ($a.ok) { $addressId = Find-FirstId $a.data; if ($addressId) { Write-Host "      address found through $pth" -ForegroundColor DarkGray; break } }
}
if (-not $addressId) { $addressId = (Read-Host 'Paste the customer address id').Trim() }
Check 'Have a dish and an address' ([bool]($productId -and $addressId)) 'missing id'

function New-Body() {
    return @{ orderType = 'delivery'; items = @(@{ productId = $productId; quantity = $qty }); paymentMethod = 'cod'; addressId = $addressId }
}

function Place-Order($label) {
    $q = Invoke-Api 'POST' '/api/orders/quote' $cTok (New-Body)
    Check "$label quote" $q.ok (Err $q)
    if ($q.ok) { Check "$label can be placed" ([bool]$q.data.canPlace) "problem: $($q.data.problem)" }
    $p = Invoke-Api 'POST' '/api/orders' $cTok (New-Body)
    Check "$label placed" $p.ok (Err $p)
    if (-not $p.ok) { return $null }
    return @{ id = (Idof $p.data); no = $p.data.orderNo }
}

# ---------------------------------------------------------------- 3. happy path
Write-Host ''; Write-Host '--- 3. Full delivery (COD, with PIN) ---' -ForegroundColor Cyan
$ord = Place-Order 'Order 1'
if (-not $ord) { Write-Host 'Cannot place an order. Stopping. If the message says Cash on delivery, set ENFORCE_NO_COD_IN_FREE=false.' -ForegroundColor Red; exit 1 }
$oid = $ord.id; $ono = $ord.no
Write-Host "      order #$ono ($oid)" -ForegroundColor DarkGray
Start-Sleep -Seconds 1

$x = Invoke-Api 'GET' '/api/shop/notifications' $oTok $null
Check 'Owner inbox shows the new order' ($x.ok -and (Text $x.data) -match "$ono") (Err $x)

$x = Invoke-Api 'PATCH' "/api/shop/orders/$oid/status" $oTok @{ status = 'accepted' }
Check 'Owner accepts' $x.ok (Err $x)
$x = Invoke-Api 'PATCH' "/api/shop/orders/$oid/status" $oTok @{ status = 'preparing' }
Check 'Owner moves to preparing' $x.ok (Err $x)
Start-Sleep -Seconds 1

# automatic mode may already have offered the order to a rider
$d = Invoke-Api 'GET' "/api/shop/orders/$oid/delivery" $oTok $null
Check 'Owner reads delivery block' $d.ok (Err $d)
$cur = $null; if ($d.ok -and $d.data.delivery) { $cur = [string]$d.data.delivery.riderId }
if ($cur -and $cur -ne $riderId) {
    Write-Host '      automatic mode gave it to another rider. Reassigning to the test rider.' -ForegroundColor DarkGray
    $x = Invoke-Api 'POST' "/api/shop/orders/$oid/assign" $oTok @{ riderId = $riderId; reason = 'e2e test' }
    Check 'Owner reassigns to test rider' $x.ok (Err $x)
} elseif (-not $cur) {
    $x = Invoke-Api 'POST' "/api/shop/orders/$oid/assign" $oTok @{ riderId = $riderId }
    Check 'Owner assigns test rider' $x.ok (Err $x)
}
Start-Sleep -Seconds 1

$x = Invoke-Api 'GET' '/api/rider/orders?tab=offered' $rTok $null
$seen = $false; if ($x.ok) { foreach ($i in @($x.data.items)) { if ((Idof $i) -eq $oid) { $seen = $true } } }
Check 'Rider sees the offer' $seen (Err $x)
$x = Invoke-Api 'GET' '/api/notifications' $rTok $null
Check 'Rider inbox has the offer' ($x.ok -and (Text $x.data) -match "$ono") (Err $x)

$x = Invoke-Api 'POST' "/api/rider/orders/$oid/accept" $rTok $null
Check 'Rider accepts' $x.ok (Err $x)
if ($x.ok) { Check 'Rider now sees customer name' ([bool]$x.data.customer) 'customer is hidden after accept' }

$t = Invoke-Api 'GET' "/api/orders/$oid/tracking" $cTok $null
Check 'Customer tracking works' $t.ok (Err $t)
if ($t.ok) {
    Check 'Tracking state is rider_assigned' ($t.data.state -eq 'rider_assigned') "state is $($t.data.state)"
    Check 'Customer sees a rider name' ([bool]$t.data.rider.name) 'no rider name'
}
$pin = $t.data.deliveryPin
Write-Host "      delivery PIN: $pin" -ForegroundColor DarkGray

$x = Invoke-Api 'POST' "/api/rider/orders/$oid/deliver" $rTok @{ pin = $pin }
Check 'Deliver before pickup is refused' ($x.status -eq 409) "got status $($x.status)"

$x = Invoke-Api 'POST' "/api/rider/orders/$oid/pickup" $rTok $null
Check 'Rider picks up' $x.ok (Err $x)
$t = Invoke-Api 'GET' "/api/orders/$oid/tracking" $cTok $null
if ($t.ok) { Check 'Tracking state is on_the_way' ($t.data.state -eq 'on_the_way') "state is $($t.data.state)" }

if ($pin) {
    $wrong = '0000'; if ($pin -eq '0000') { $wrong = '1111' }
    $x = Invoke-Api 'POST' "/api/rider/orders/$oid/deliver" $rTok @{ pin = $wrong }
    Check 'Wrong PIN is refused' ($x.status -eq 400) "got status $($x.status)"
}
$x = Invoke-Api 'POST' "/api/rider/orders/$oid/deliver" $rTok @{ pin = $pin }
Check 'Rider delivers with the right PIN' $x.ok (Err $x)

$x = Invoke-Api 'GET' "/api/shop/orders/$oid" $oTok $null
if ($x.ok) {
    Check 'Order is delivered' ($x.data.status -eq 'delivered') "status is $($x.data.status)"
    Check 'COD marked paid' ($x.data.payment.status -eq 'paid') "payment is $($x.data.payment.status)"
} else { Check 'Owner reads the order' $false (Err $x) }

$s = Invoke-Api 'GET' '/api/rider/summary' $rTok $null
if ($s.ok) {
    Check 'Rider summary counts the delivery' ($s.data.deliveries.total -ge 1) "total is $($s.data.deliveries.total)"
    Check 'Rider owes the shop the COD cash' ($s.data.cash.owedToShopPaise -gt 0) "owed is $($s.data.cash.owedToShopPaise)"
} else { Check 'Rider summary' $false (Err $s) }

$x = Invoke-Api 'POST' "/api/orders/$oid/delivery-rating" $cTok @{ rating = 5; tags = @('On time'); comment = 'Polite' }
Check 'Customer rates the delivery' $x.ok (Err $x)
$x = Invoke-Api 'POST' "/api/orders/$oid/delivery-rating" $cTok @{ rating = 4 }
Check 'Second rating is refused' ($x.status -eq 409) "got status $($x.status)"
$x = Invoke-Api 'GET' '/api/rider/me' $rTok $null
if ($x.ok) { Check 'Rider rating count went up' ($x.data.ratingCount -ge 1) "count is $($x.data.ratingCount)"; Check 'Rider has no stuck slot' ($x.data.activeOrderCount -eq 0) "activeOrderCount is $($x.data.activeOrderCount)" }

# ---------------------------------------------------------------- 4. problem report and reassign
Write-Host ''; Write-Host '--- 4. Problem report and taking the order back ---' -ForegroundColor Cyan
$ord2 = Place-Order 'Order 2'
if ($ord2) {
    $oid2 = $ord2.id; $ono2 = $ord2.no
    Write-Host "      order #$ono2 ($oid2)" -ForegroundColor DarkGray
    $x = Invoke-Api 'PATCH' "/api/shop/orders/$oid2/status" $oTok @{ status = 'accepted' };  Check 'Order 2 accepted' $x.ok (Err $x)
    $x = Invoke-Api 'PATCH' "/api/shop/orders/$oid2/status" $oTok @{ status = 'preparing' }; Check 'Order 2 preparing' $x.ok (Err $x)
    Start-Sleep -Seconds 1
    $d = Invoke-Api 'GET' "/api/shop/orders/$oid2/delivery" $oTok $null
    $cur = $null; if ($d.ok -and $d.data.delivery) { $cur = [string]$d.data.delivery.riderId }
    if ($cur -and $cur -ne $riderId) {
        $x = Invoke-Api 'POST' "/api/shop/orders/$oid2/assign" $oTok @{ riderId = $riderId; reason = 'e2e test' }
    } elseif (-not $cur) {
        $x = Invoke-Api 'POST' "/api/shop/orders/$oid2/assign" $oTok @{ riderId = $riderId }
    } else { $x = @{ ok = $true } }
    Check 'Order 2 assigned to test rider' $x.ok (Err $x)
    $x = Invoke-Api 'POST' "/api/rider/orders/$oid2/accept" $rTok $null; Check 'Rider accepts order 2' $x.ok (Err $x)

    $x = Invoke-Api 'POST' "/api/rider/orders/$oid2/problem" $rTok @{ reason = 'cannot_reach'; note = 'gate is locked' }
    Check 'Rider reports a problem' $x.ok (Err $x)
    $x = Invoke-Api 'POST' "/api/rider/orders/$oid2/problem" $rTok @{ reason = 'bad_reason' }
    Check 'Bad problem reason is refused' ($x.status -eq 400) "got status $($x.status)"
    Start-Sleep -Seconds 1
    $x = Invoke-Api 'GET' '/api/shop/notifications' $oTok $null
    Check 'Owner inbox shows Delivery problem' ($x.ok -and (Text $x.data) -match 'Delivery problem') (Err $x)

    $x = Invoke-Api 'POST' "/api/shop/orders/$oid2/unassign" $oTok @{ }
    Check 'Unassign without a reason is refused' ($x.status -eq 400) "got status $($x.status)"
    $x = Invoke-Api 'POST' "/api/shop/orders/$oid2/unassign" $oTok @{ reason = 'e2e test: rider not answering' }
    Check 'Owner takes the order back' $x.ok (Err $x)
    Start-Sleep -Seconds 1
    $x = Invoke-Api 'GET' '/api/notifications' $rTok $null
    Check 'Old rider is told (Order taken back)' ($x.ok -and (Text $x.data) -match 'taken back') (Err $x)
    $x = Invoke-Api 'GET' '/api/rider/me' $rTok $null
    if ($x.ok) { Check 'Rider slot is given back' ($x.data.activeOrderCount -eq 0) "activeOrderCount is $($x.data.activeOrderCount)" }

    $x = Invoke-Api 'PATCH' "/api/shop/orders/$oid2/status" $oTok @{ status = 'cancelled'; note = 'e2e test cleanup' }
    Check 'Owner cancels order 2 (cleanup)' $x.ok (Err $x)
}

# ---------------------------------------------------------------- result
Write-Host ''
Write-Host "RESULT: $script:pass passed, $script:fail failed" -ForegroundColor Cyan
if ($script:fail -gt 0) {
    Write-Host ''
    Write-Host 'Copy these lines and send them to me:' -ForegroundColor Yellow
    $script:failures | ForEach-Object { Write-Host $_ }
}
Write-Host ''
Write-Host 'Note: this test made 2 real orders (1 delivered, 1 cancelled) in the shop.' -ForegroundColor DarkGray