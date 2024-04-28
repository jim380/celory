import { ethers } from "ethers";
import { ContractKit, newKit } from "@celo/contractkit";
import winston from "winston";

export interface BalanceCheckerResult {
  cUSD: number;
  CELO: number;
  lockedCELO: number;
  pending: number;
}

export class BalanceChecker {
  kit: ContractKit;
  provider: ethers.JsonRpcProvider;
  walletAddresses: string[];
  logger: winston.Logger;

  constructor(
    rpcUrl: string,
    walletAddresses: string[],
    logger: winston.Logger
  ) {
    this.kit = newKit(rpcUrl);
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.walletAddresses = walletAddresses;
    this.logger = logger;
  }

  async run(): Promise<BalanceCheckerResult> {
    let totalBalance: BalanceCheckerResult = {
      cUSD: 0,
      CELO: 0,
      lockedCELO: 0,
      pending: 0,
    };

    const balances = await Promise.all(
      this.walletAddresses.map((e) => this.kit.getTotalBalance(e))
    );

    balances.forEach((balance) => {
      totalBalance.cUSD += balance.cUSD!.toNumber();
      totalBalance.CELO += balance.CELO!.toNumber();
      totalBalance.lockedCELO += balance.lockedCELO!.toNumber();
      totalBalance.pending += balance.pending!.toNumber();
    });

    this.logger.info(`Total balance: ${JSON.stringify(totalBalance)}`);

    return totalBalance;
  }
}
