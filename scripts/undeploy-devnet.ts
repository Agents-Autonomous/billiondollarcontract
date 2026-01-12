import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Billion } from "../target/types/billion";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { execFileSync } from "child_process";

// Helper functions for PDA derivation
function deriveGridConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("grid_config")],
    programId
  );
}

function deriveParcelInfo(
  programId: PublicKey,
  parcelId: number
): [PublicKey, number] {
  const parcelIdBuffer = Buffer.alloc(2);
  parcelIdBuffer.writeUInt16LE(parcelId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("parcel"), parcelIdBuffer],
    programId
  );
}

function deriveLandBuyRewardPool(
  programId: PublicKey,
  gridConfig: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("land_buy_reward_pool"), gridConfig.toBuffer()],
    programId
  );
}

async function main() {
  console.log("===========================================");
  console.log("  Billion Grid - Devnet Undeployment");
  console.log("===========================================\n");

  // Configure provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.billion as Program<Billion>;
  const authority = provider.wallet as anchor.Wallet;

  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Network:", provider.connection.rpcEndpoint);
  console.log("");

  // Check starting balance
  const startingBalance = await provider.connection.getBalance(
    authority.publicKey
  );
  console.log("Starting Balance:", (startingBalance / 1e9).toFixed(6), "SOL");

  // Derive PDAs
  const [gridConfigPda] = deriveGridConfig(program.programId);

  // Check if initialized
  let gridConfig;
  try {
    gridConfig = await program.account.gridConfig.fetch(gridConfigPda);
  } catch {
    console.log("\n[!] Grid is not initialized. Nothing to undeploy.");
    process.exit(0);
  }

  console.log("\n--- Current State ---");
  console.log("GridConfig PDA:", gridConfigPda.toBase58());
  console.log("Token Mint:", gridConfig.tokenMint.toBase58());
  console.log("Block Map:", gridConfig.blockMap.toBase58());
  console.log("Next Parcel ID:", gridConfig.nextParcelId);
  console.log("Reward Pool:", gridConfig.landBuyRewardPool.toBase58());

  const [landBuyRewardPool] = deriveLandBuyRewardPool(
    program.programId,
    gridConfigPda
  );

  // Check reward pool balance
  try {
    const rewardPoolInfo = await provider.connection.getTokenAccountBalance(
      landBuyRewardPool
    );
    console.log(
      "Reward Pool Balance:",
      rewardPoolInfo.value.uiAmountString,
      "tokens"
    );
  } catch {
    console.log("Reward Pool Balance: 0 (or account not found)");
  }

  // Count parcels to close
  const parcelCount = gridConfig.nextParcelId - 1; // parcel IDs start at 1
  console.log(`\nParcels to close: ${parcelCount}`);

  // Confirm before proceeding
  console.log("\n===========================================");
  console.log("  WARNING: This will close all accounts!");
  console.log("===========================================");
  console.log("\nThis action will:");
  console.log(`  - Close ${parcelCount} ParcelInfo PDAs`);
  console.log("  - Drain all tokens from reward pool");
  console.log("  - Close reward pool, BlockMap, and GridConfig");
  console.log("  - Close the program itself");
  console.log("\nProceeding in 5 seconds...\n");

  await new Promise((resolve) => setTimeout(resolve, 5000));

  // ============================================
  // Step 1: Close all ParcelInfo PDAs
  // ============================================
  console.log("\n--- Step 1: Closing ParcelInfo PDAs ---");

  for (let parcelId = 1; parcelId <= parcelCount; parcelId++) {
    const [parcelInfoPda] = deriveParcelInfo(program.programId, parcelId);

    // Check if account exists
    const accountInfo = await provider.connection.getAccountInfo(parcelInfoPda);
    if (!accountInfo) {
      console.log(`  Parcel ${parcelId}: Already closed or doesn't exist`);
      continue;
    }

    try {
      const sig = await program.methods
        .adminCloseParcelInfo(parcelId)
        .accountsPartial({
          authority: authority.publicKey,
          gridConfig: gridConfigPda,
          parcelInfo: parcelInfoPda,
        })
        .rpc();

      console.log(`  Parcel ${parcelId}: Closed (${sig.slice(0, 8)}...)`);
    } catch (error: any) {
      console.error(`  Parcel ${parcelId}: Failed - ${error.message}`);
    }
  }

  // ============================================
  // Step 2: Create authority's token account if needed
  // ============================================
  console.log("\n--- Step 2: Ensuring authority token account exists ---");

  const authorityTokenAccount = getAssociatedTokenAddressSync(
    gridConfig.tokenMint,
    authority.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const tokenAccountInfo = await provider.connection.getAccountInfo(
    authorityTokenAccount
  );

  if (!tokenAccountInfo) {
    console.log("  Creating authority token account...");
    const createAtaIx = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      authorityTokenAccount,
      authority.publicKey,
      gridConfig.tokenMint,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(createAtaIx);
    await provider.sendAndConfirm(tx);
    console.log("  Created:", authorityTokenAccount.toBase58());
  } else {
    console.log("  Already exists:", authorityTokenAccount.toBase58());
  }

  // ============================================
  // Step 3: Call admin_purge
  // ============================================
  console.log("\n--- Step 3: Running admin_purge ---");

  try {
    const sig = await program.methods
      .adminPurge()
      .accountsPartial({
        authority: authority.publicKey,
        gridConfig: gridConfigPda,
        blockMap: gridConfig.blockMap,
        tokenMint: gridConfig.tokenMint,
        landBuyRewardPool: landBuyRewardPool,
        authorityTokenAccount: authorityTokenAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  Admin purge complete:", sig);
  } catch (error: any) {
    console.error("  Admin purge failed:", error.message);
    console.log("\n  Logs:", error.logs?.join("\n  "));
    process.exit(1);
  }

  // ============================================
  // Step 4: Close the program
  // ============================================
  console.log("\n--- Step 4: Closing program ---");

  try {
    const result = execFileSync(
      "solana",
      ["program", "close", program.programId.toBase58(), "--bypass-warning"],
      { encoding: "utf-8" }
    );
    console.log(result);
  } catch (error: any) {
    console.error("Error closing program:", error.message);
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
  }

  // ============================================
  // Final Summary
  // ============================================
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const endingBalance = await provider.connection.getBalance(
    authority.publicKey
  );
  const reclaimed = (endingBalance - startingBalance) / 1e9;

  console.log("\n===========================================");
  console.log("  Undeployment Complete");
  console.log("===========================================\n");

  console.log("Starting Balance:", (startingBalance / 1e9).toFixed(6), "SOL");
  console.log("Ending Balance:  ", (endingBalance / 1e9).toFixed(6), "SOL");
  console.log("Reclaimed:       ", reclaimed.toFixed(6), "SOL");
}

main().catch(console.error);
