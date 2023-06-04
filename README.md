## Instructions

### Build

```
$ docker build -t csc:v0.1.0 .
```

### Run

```
$ docker run --name csc -dt --restart unless-stopped -p 3000:3000 csc:v0.1.0
$ docker logs csc  -f --since 1m
```

### Endpoints

#### Signing Status of Selected Signers

From the list of signers passed in `main.js`, if a signer is currently elected and signing, her address will appear on this endpoint. If not, then she missed signing that block.

```
http://localhost:3000/signed
```

#### All Missing Signers at Current Block

All elected signers that missed signing the latest block will appear on this endpoint.

```
http://localhost:3000/unsignedAll
```

### Set Up Alerts

You can set up alerts however you want. Personally I use Uptime Kuma to periodically scrape the endpoints and do a keyword search. For instance:

- If the signer address I'm monitoring appears on `http://localhost:3000/signed`, then the signer signed that block and the keyword search will succeed

- If instead the address is absent on `http://localhost:3000/signed`, then the signer missed that block and the keyword search will fail, triggering a alert which I have sent via Telegram
