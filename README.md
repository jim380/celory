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

- If all monitored signers are currently elected and signing, return `ok`
- If there exist any unsigned monitored signers, return `not ok` and the signers' addresses

```
http://localhost:3000/monitored-health
```

#### All Missing Signers at Current Block

Return all elected signers that missed signing the latest block.

```
http://localhost:3000/unsigned-all
```

#### Balance Checking

Return the total balances of a list of wallet addresses in the following currencies:

- cUSD
- CELO
- Locked Celo
- Pending Celo

```
http://localhost:3000/unsigned-all
```

### Set Up Alerts

You can set up alerts however you want. Personally I use Uptime Kuma to periodically scrape the endpoints and do a keyword search. For instance:

- Keyword search on each signer address at `/monitored-health`. If the search fails, then the signer signed that block. Conversely, if search succeeds, an alert is triggered via Telegram to signal the signer didn't sign that block

- Alternatively, keyword search on each signer address at `http://localhost:3000/unsigned-all`, if the search fails, then the signer signed that block. Conversely, if search succeeds, an alert is triggered via Telegram to signal the signer didn't sign that block
