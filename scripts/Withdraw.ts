import dotenv from "dotenv";
import Web3 from "web3";
import { newKit, CeloContract } from "@celo/contractkit";
import { GoldTokenWrapper } from "@celo/contractkit/lib/wrappers/GoldTokenWrapper";
import { ExchangeWrapper } from "@celo/contractkit/lib/wrappers/Exchange";
import { StableTokenWrapper } from "@celo/contractkit/lib/wrappers/StableTokenWrapper";

dotenv.config();

const rpcUrl = process.env.RPC_URL ?? "https://forno.celo.org";
const kit = newKit(rpcUrl);
const web3 = new Web3(rpcUrl);

const usesRGContract = true;
// addresses
const RG_CONTRACT_ADDRESS = "";
const RG_BENEFICIARY_ADDRESS = ""; // signer if using RG contract
const VALIDATOR_ADDRESS = ""; // signer if not using RG contract
const RECIPIENT_ADDRESS = "";

// beneficiary account
const account = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY!);

// constants
const oneCelo = kit.web3.utils.toWei("1", "ether");

// configure kit
kit.connection.addAccount(account.privateKey);
kit.defaultAccount = account.address;

// transfer cUSD from RG contract to beneficiary
async function withdrawDollars(
  cUSDContract: StableTokenWrapper,
  cUSDBalance: string
) {
  const xferCUSDTxn = await cUSDContract
    .transfer(RG_BENEFICIARY_ADDRESS, cUSDBalance)
    .send({ from: account.address });
  let xferCUSDReceipt = await xferCUSDTxn.waitReceipt();
  console.log(
    `Withdrew ${cUSDBalance} cUSD to ${RG_BENEFICIARY_ADDRESS}.\nTxn hash: ${xferCUSDReceipt.blockHash}`
  );
}

async function exchangeDollarsForCelo(
  cusdContract: StableTokenWrapper,
  exchange: ExchangeWrapper,
  cUSDBalance: string
) {
  const approveTxn = await cusdContract
    .approve(exchange.address, cUSDBalance)
    .send({ from: account.address });
  const approveReceipt = await approveTxn.waitReceipt();
  console.log(
    `Approved exchanging ${cUSDBalance} cUSD.\nTxn hash: ${approveReceipt.blockHash}`
  );

  const celoToAcquireQuote = await exchange.quoteStableSell(cUSDBalance!);
  const sellTxn = await exchange
    .sellStable(cUSDBalance!, celoToAcquireQuote)
    .send({ from: account.address });
  const sellReceipt = await sellTxn.waitReceipt();
  console.log(
    `Exchanged ${cUSDBalance} cUSD for ${celoToAcquireQuote} CELO.\nTxn hash: ${sellReceipt.blockHash}`
  );
}

// send CELO to recipient
async function transferCELO(celoContract: GoldTokenWrapper, celoBalance: any) {
  const xferCeloAmount = celoBalance.minus(
    oneCelo // save 1 CELO for gas
  );
  let xferCeloTxn = await celoContract
    .transfer(RECIPIENT_ADDRESS, xferCeloAmount!.toString())
    .send({ from: account.address });
  let xferCeloReceipt = await xferCeloTxn.waitReceipt();
  console.log(
    `Sent ${xferCeloAmount} CELO to ${RECIPIENT_ADDRESS}.\nTxn hash: ${xferCeloReceipt.blockHash}`
  );
}

async function main() {
  await kit.setFeeCurrency(CeloContract.GoldToken); // paid gas in CELO

  const exchange = await kit.contracts.getExchange();
  const celoContract = await kit.contracts.getGoldToken();
  const cUSDContract = await kit.contracts.getStableToken();

  let cUSDBalance: string;
  if (usesRGContract) {
    cUSDBalance = (
      await kit.getTotalBalance(RG_CONTRACT_ADDRESS)
    ).cUSD!.toString();
    await withdrawDollars(cUSDContract, cUSDBalance);
  } else {
    cUSDBalance = (
      await kit.getTotalBalance(VALIDATOR_ADDRESS)
    ).cUSD!.toString();
  }

  // exchange cUSD for CELO
  await exchangeDollarsForCelo(cUSDContract, exchange, cUSDBalance);

  // send CELO
  const celoBalance = (await kit.getTotalBalance(account.address)).CELO;
  await transferCELO(celoContract, celoBalance!);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
