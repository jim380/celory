import { ethers } from "ethers";
import { ContractKit, newKit } from "@celo/contractkit";
import winston from "winston";

export interface BalanceCheckerResult {
  address: string;
  cUSD: number;
  CELO: number;
  lockedCELO: number;
  pending: number;
}

export class BalanceChecker {
  kit: ContractKit;
  provider: ethers.JsonRpcProvider;
  logger: winston.Logger;

  constructor(rpcUrl: string, logger: winston.Logger) {
    this.kit = newKit(rpcUrl);
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.logger = logger;
  }

  // always query on the fly for now
  async run(addresses: string[]): Promise<BalanceCheckerResult[]> {
    const balances = await Promise.all(
      addresses.map((address) => this.kit.getTotalBalance(address))
    );

    const results: BalanceCheckerResult[] = balances.map((balance, i) => ({
      address: addresses[i],
      cUSD: balance.cUSD!.toNumber(),
      CELO: balance.CELO!.toNumber(),
      lockedCELO: balance.lockedCELO!.toNumber(),
      pending: balance.pending!.toNumber(),
    }));

    this.logger.info(`Balances: ${JSON.stringify(results)}`);

    return results;
  }
}
