# Cloudflare JSON error verification

Verified on 2026-10-07 against the existing public tunnel. The tunnel was kept running throughout verification.

An isolated fixed diagnostic response from the web origin reproduced the issue without account tokens or image requests:

| Origin status/body | Direct localhost | Public tunnel |
| --- | --- | --- |
| 502 JSON | 502 application/json | 502 text/html; body starts with DOCTYPE |
| 424 JSON | 424 application/json | 424 application/json; original JSON preserved |

The temporary probe was removed after verification.

The active tunnel metrics showed zero proxy connection errors and four origin 502 responses before probing. Bridge output separately recorded an edit provider rejection with HTTP 400 and code moderation_blocked. This proves the error translation mechanism; the provider record is not correlated to an individual visitor.

The web API now maps dependency failures to 424 and moderation_blocked to 422, retaining safe provider codes across background job completion. No automatic generation retry is introduced. Actual generation success on the user's mobile account remains to be verified by the user.
