## Instructions

### Develop

```
$ ts-node src/main.ts
```

### Build

```
$ docker build -t celory:v0.2.0 .
```

### Run

```
$ docker run --name celory -dt --restart unless-stopped -p 3000:3000 celory:v0.2.0
$ docker logs celory  -f --since 1m
```

### Endpoints

#### Signing Status of Selected Signers

- If all monitored signers are currently elected and signing, return `ok`
- If there exist any unsigned monitored signers, return `not ok` and the signers' addresses

```
http://localhost:3000/monitored-health
```

#### All Missing Signers at Current Block

Return all elected signers that missed signing the provided block. If no height is provided, it defaults to the latest height.

```
http://localhost:3000/unsigned-all?height=25807696
```

<details>

<summary>sample response</summary>

```
{
  "response": [
    "0xa1b2n3",
    "0xa2b1n3",
    "0xa3b1n2"
  ]
}
```

</details>

#### Balances

```
http://localhost:3000/total-balances?addresses=address1,address2
```

<details>

<summary>sample response</summary>

```
[
  {
    "address": "0xa1b2c3",
    "cUSD": 3.671203119475774e+20,
    "CELO": 10e+18,
    "lockedCELO": 1.6081474071783015e+22,
    "pending": 0
  }
]
```

</details>

#### Groups

```
http://localhost:3000/groups?addresses=address1,address2
```

<details>

<summary>sample response</summary>

```
[
  {
    "name": "xxx",
    "address": "0xa1b2n3",
    "isEligible": true,
    "votes": {
      "total": "33986790238763413271873945",
      "active": "2292302637123341327812649",
      "pending": "58000000000000000000",
      "receivable": "6209783760702825668042803"
    },
    "members": [
      {
        "address": "0xa1b2n3",
        "voteSigner": "0xa1b2n3",
        "elected": true,
        "score": "999857935711900000000000"
      },
      {
        "address": "0xa1b2n3",
        "voteSigner": "0xa1b2n3",
        "elected": true,
        "score": "984506022753400000000000"
      }
    ],
    "commission": 0.1,
    "lastSlashed": "0",
    "voteSigner": "0xa1b2n3",
    "domain": "xxx.com"
  }
]
```

</details>

#### Validators

```
http://localhost:3000/validators?addresses=address1,address2
```

<details>

<summary>sample response</summary>

```
[
  {
    "group": {
      "name": "xxx",
      "address": "0xa1b2n3",
      "isEligible": true,
      "votes": {
        "total": "33986790238763413271873945",
        "active": "2292302637123341327812649",
        "pending": "58000000000000000000",
        "receivable": "6209783760702825668042803"
      },
      "members": [
        {
          "address": "0xa1b2n3",
          "voteSigner": "0xa1b2n3",
          "elected": true,
          "score": "999857935711900000000000"
        },
        {
          "address": "0xa1b2n3",
          "voteSigner": "0xa1b2n3",
          "elected": true,
          "score": "984506022753400000000000"
        }
      ],
      "commission": 0.1,
      "lastSlashed": "0",
      "voteSigner": "0xa1b2n3",
      "domain": "xxx.com"
    },
    "address": "0x0EBdCCD9091EFB1243417bDf3aDdd63132962586",
    "voteSigner": "0x19Da3C0D7af94804cDA2948f7634cD8e9510d433",
    "elected": true,
    "score": "999999999991900000000000"
  }
]
```

</details>

### Set Up Alerts

You can set up alerts however you want. Personally I use Uptime Kuma to periodically scrape the endpoints and do a keyword search. For instance:

- Keyword search on each signer address at `/monitored-health`. If the search fails, then the signer signed that block. Conversely, if search succeeds, an alert is triggered via Telegram to signal the signer didn't sign that block

- Alternatively, keyword search on each signer address at `http://localhost:3000/unsigned-all`, if the search fails, then the signer signed that block. Conversely, if search succeeds, an alert is triggered via Telegram to signal the signer didn't sign that block
