import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Billion } from "../target/types/billion";
import { Connection, PublicKey } from "@solana/web3.js";

// ============================================
// MAINNET CONFIGURATION
// ============================================

const RPC_URL =
  "https://mainnet.helius-rpc.com/?api-key=82ef2bd1-98fa-4bf6-af02-58d9577701b5";

const PROGRAM_ID = new PublicKey("BDBCR33yBuWjGJiGXoApW3qR9ajP2fGSJfzTP6SbYn6h");

// ============================================
// HELPER FUNCTIONS
// ============================================

function deriveGridConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("grid_config")],
    programId
  );
}

function formatTokens(amount: anchor.BN, decimals: number = 6): string {
  const value = amount.toNumber() / Math.pow(10, decimals);
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatBigTokens(amount: anchor.BN, decimals: number = 6): string {
  // For very large numbers, divide step by step to avoid overflow
  const divisor = Math.pow(10, decimals);
  const value = amount.div(new anchor.BN(divisor)).toNumber();
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ============================================
// MAIN SCRIPT
// ============================================

async function main() {
  console.log("===========================================");
  console.log("  Billion Grid - Grid Config (Mainnet)");
  console.log("===========================================\n");

  // Connect to mainnet
  const connection = new Connection(RPC_URL, "confirmed");

  // Create a minimal provider (no wallet needed for reading)
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: PublicKey.default,
      signTransaction: async (tx) => tx,
      signAllTransactions: async (txs) => txs,
    } as anchor.Wallet,
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.billion as Program<Billion>;
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log("Network:", RPC_URL.split("?")[0]);
  console.log("");

  // Derive GridConfig PDA
  const [gridConfigPda, bump] = deriveGridConfig(PROGRAM_ID);
  console.log("GridConfig PDA:", gridConfigPda.toBase58());
  console.log("GridConfig Bump:", bump);
  console.log("");

  // Fetch GridConfig
  let gridConfig;
  try {
    gridConfig = await program.account.gridConfig.fetch(gridConfigPda);
  } catch (err) {
    console.error("Failed to fetch GridConfig. The grid may not be initialized on mainnet.");
    console.error("Error:", err);
    process.exit(1);
  }

  // Print all configuration fields
  console.log("===========================================");
  console.log("  Grid Configuration");
  console.log("===========================================\n");

  console.log("AUTHORITY & ACCOUNTS");
  console.log("--------------------------------------------");
  console.log("Authority:              ", gridConfig.authority.toBase58());
  console.log("Token Mint:             ", gridConfig.tokenMint.toBase58());
  console.log("Block Map:              ", gridConfig.blockMap.toBase58());
  console.log("Collection:             ", gridConfig.collection.toBase58());
  console.log("Land Buy Reward Pool:   ", gridConfig.landBuyRewardPool.toBase58());
  console.log("");

  console.log("PRICING & BURNING");
  console.log("--------------------------------------------");
  console.log("Price per Block:        ", formatTokens(gridConfig.pricePerBlock), "tokens");
  console.log("Total Burned:           ", formatBigTokens(gridConfig.totalBurned), "tokens");
  console.log("");

  console.log("RING THRESHOLDS (tokens burned to unlock)");
  console.log("--------------------------------------------");
  gridConfig.ringThresholds.forEach((threshold: anchor.BN, index: number) => {
    const ringNum = index + 1;
    const thresholdStr = formatBigTokens(threshold);
    console.log(`  Ring ${ringNum.toString().padStart(2, " ")}:             ${thresholdStr.padStart(15)} tokens`);
  });
  console.log("");

  console.log("PARCEL & GRID STATE");
  console.log("--------------------------------------------");
  console.log("Next Parcel ID:         ", gridConfig.nextParcelId);
  console.log("Total Claimed Blocks:   ", gridConfig.totalClaimedBlocks);
  console.log("Seeding Enabled:        ", gridConfig.seedingEnabled);
  console.log("URI Base:               ", gridConfig.uriBase);
  console.log("");

  console.log("LAND BUY REWARDS");
  console.log("--------------------------------------------");
  console.log("Land Owners Share:      ", gridConfig.landOwnersRewardShareBps / 100, "%");
  console.log("Rewards per Block:      ", gridConfig.landBuyRewardsPerBlock.toString(), "(scaled by 1e9)");
  console.log("");

  console.log("ACCOUNT INFO");
  console.log("--------------------------------------------");
  console.log("PDA Bump:               ", gridConfig.bump);
  console.log("");

  // Print explorer links
  console.log("===========================================");
  console.log("  Explorer Links");
  console.log("===========================================\n");
  console.log(`Program:     https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}`);
  console.log(`GridConfig:  https://explorer.solana.com/address/${gridConfigPda.toBase58()}`);
  console.log(`BlockMap:    https://explorer.solana.com/address/${gridConfig.blockMap.toBase58()}`);
  console.log(`Collection:  https://explorer.solana.com/address/${gridConfig.collection.toBase58()}`);
  console.log(`Token Mint:  https://explorer.solana.com/address/${gridConfig.tokenMint.toBase58()}`);
}

main().catch(console.error);
