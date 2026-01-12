import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Billion } from "../target/types/billion";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { execFileSync } from "child_process";
import * as path from "path";
import * as readline from "readline";

// ============================================
// CONFIGURATION
// ============================================

// Set to true for dry run (no transactions, just show what would happen)
const DRY_RUN = false;

// Worker directory for wrangler commands
const WORKER_DIR = path.resolve(__dirname, "../../worker");

// D1 database binding name (from wrangler.toml)
const D1_DATABASE = "million-dollar-db-staging";

// Metaplex Core Program ID
const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
);

// ============================================
// Types
// ============================================

interface DbParcel {
  id: string;
  on_chain_parcel_id: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  owner_wallet: string;
  image_url: string;
  link_url: string | null;
  title: string | null;
}

// ============================================
// Helper functions
// ============================================

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
  return PublicKey.findProgramAddressSync(
    [Buffer.from("parcel"), new anchor.BN(parcelId).toArrayLike(Buffer, "le", 2)],
    programId
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prompt user for confirmation (y/n)
 */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Validate parcel ID format to prevent injection
 * Accepts either UUID format or coordinate format (e.g., "0-10-5x5")
 */
function isValidParcelId(str: string): boolean {
  // UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Coordinate format: {x}-{y}-{width}x{height}
  const coordRegex = /^\d+-\d+-\d+x\d+$/;
  return uuidRegex.test(str) || coordRegex.test(str);
}

/**
 * Query D1 database for parcels without on-chain IDs
 * Uses execFileSync for safety (no shell injection)
 */
function queryUnclaimedParcels(): DbParcel[] {
  console.log("Querying D1 for unclaimed parcels...");
  console.log(`Worker dir: ${WORKER_DIR}`);

  const query = "SELECT id, on_chain_parcel_id, x, y, width, height, owner_wallet, image_url, link_url, title FROM parcels WHERE on_chain_parcel_id IS NULL";

  try {
    // Use execFileSync with array args to prevent shell injection
    const result = execFileSync(
      "wrangler",
      ["d1", "execute", D1_DATABASE, "--remote", "--command", query, "--json"],
      {
        cwd: WORKER_DIR,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      }
    );

    const parsed = JSON.parse(result);

    // wrangler d1 execute returns an array with query results
    if (parsed && parsed[0] && parsed[0].results) {
      return parsed[0].results as DbParcel[];
    }

    return [];
  } catch (error) {
    console.error("Failed to query D1:", error);
    throw error;
  }
}

/**
 * Update parcel in D1 with on-chain parcel ID
 * Uses execFileSync for safety (no shell injection)
 */
function updateParcelOnChainId(parcelDbId: string, onChainParcelId: number): void {
  // Validate inputs to prevent SQL injection
  if (!isValidParcelId(parcelDbId)) {
    throw new Error(`Invalid parcel DB ID format: ${parcelDbId}`);
  }
  if (!Number.isInteger(onChainParcelId) || onChainParcelId < 0) {
    throw new Error(`Invalid on-chain parcel ID: ${onChainParcelId}`);
  }

  const query = `UPDATE parcels SET on_chain_parcel_id = ${onChainParcelId} WHERE id = '${parcelDbId}'`;

  try {
    // Use execFileSync with array args to prevent shell injection
    execFileSync(
      "wrangler",
      ["d1", "execute", D1_DATABASE, "--remote", "--command", query],
      {
        cwd: WORKER_DIR,
        encoding: "utf-8"
      }
    );
  } catch (error) {
    console.error(`Failed to update parcel ${parcelDbId} in D1:`, error);
    throw error;
  }
}

// ============================================
// Main script
// ============================================

async function main() {
  console.log("===========================================");
  console.log("  Admin Claim Parcels from Database");
  console.log("  Environment: STAGING (Devnet)");
  console.log("===========================================\n");

  if (DRY_RUN) {
    console.log("*** DRY RUN MODE - No transactions will be sent ***\n");
  }

  // Query unclaimed parcels from D1
  const parcels = queryUnclaimedParcels();

  if (parcels.length === 0) {
    console.log("No unclaimed parcels found in database.");
    process.exit(0);
  }

  console.log(`Found ${parcels.length} unclaimed parcel(s):\n`);

  for (const p of parcels) {
    console.log(`  - DB ID: ${p.id}`);
    console.log(`    Position: (${p.x}, ${p.y}) ${p.width}x${p.height}`);
    console.log(`    Owner: ${p.owner_wallet}`);
    console.log(`    Title: ${p.title || "(none)"}`);
    console.log("");
  }

  if (DRY_RUN) {
    console.log("Dry run complete. Set DRY_RUN = false to execute.");
    process.exit(0);
  }

  // Configure provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.billion as Program<Billion>;
  const authority = provider.wallet as anchor.Wallet;

  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Network:", provider.connection.rpcEndpoint);
  console.log("");

  // Check balance
  const balance = await provider.connection.getBalance(authority.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  // Minimum SOL needed per parcel (~0.015 SOL for rent + fees)
  const minRequired = parcels.length * 0.015;
  if (balance < minRequired * 1e9) {
    console.error(`Insufficient balance. Need at least ${minRequired.toFixed(3)} SOL.`);
    process.exit(1);
  }

  // Derive PDAs
  const [gridConfigPda] = deriveGridConfig(program.programId);
  console.log("GridConfig PDA:", gridConfigPda.toBase58());

  // Fetch current grid config
  const gridConfig = await program.account.gridConfig.fetch(gridConfigPda);
  console.log("Block Map:", gridConfig.blockMap.toBase58());
  console.log("Collection:", gridConfig.collection.toBase58());
  console.log("Seeding Enabled:", gridConfig.seedingEnabled);
  console.log("Next Parcel ID:", gridConfig.nextParcelId);
  console.log("");

  // Check if seeding is enabled (required for admin_mint)
  if (!gridConfig.seedingEnabled) {
    console.error("Seeding is disabled. Enable it first with update_config.");
    console.log("\nTo enable seeding, run:");
    console.log("  program.methods.updateConfig(null, null, null, true, null, null)");
    process.exit(1);
  }

  // Process each parcel
  console.log("===========================================");
  console.log("  Processing Parcels");
  console.log("===========================================\n");

  let successCount = 0;
  let failCount = 0;
  const results: { dbId: string; onChainId: number | null; error?: string }[] = [];

  for (let i = 0; i < parcels.length; i++) {
    const parcel = parcels[i];
    const parcelNum = i + 1;

    console.log(`[${parcelNum}/${parcels.length}] Parcel at (${parcel.x}, ${parcel.y}) ${parcel.width}x${parcel.height}`);
    console.log(`    DB ID: ${parcel.id}`);
    console.log(`    Owner: ${parcel.owner_wallet}`);
    console.log(`    Title: ${parcel.title || "(none)"}`);

    // Ask for confirmation
    const shouldMint = await confirm(`    Mint this parcel?`);
    if (!shouldMint) {
      console.log(`    Skipped.\n`);
      results.push({ dbId: parcel.id, onChainId: null, error: "Skipped by user" });
      continue;
    }

    try {
      const recipient = new PublicKey(parcel.owner_wallet);

      // Generate new asset keypair for the NFT
      const assetKeypair = Keypair.generate();

      // Fetch latest grid config to get current next_parcel_id
      const currentConfig = await program.account.gridConfig.fetch(gridConfigPda);
      const expectedParcelId = currentConfig.nextParcelId;

      // Derive the parcel info PDA for this parcel
      const [parcelInfoPda] = deriveParcelInfo(program.programId, expectedParcelId);

      console.log(`    On-chain Parcel ID: ${expectedParcelId}`);
      console.log(`    Asset: ${assetKeypair.publicKey.toBase58()}`);

      // Call admin_mint
      const tx = await program.methods
        .adminMint(parcel.x, parcel.y, parcel.width, parcel.height)
        .accountsPartial({
          authority: authority.publicKey,
          recipient: recipient,
          gridConfig: gridConfigPda,
          blockMap: gridConfig.blockMap,
          parcelInfo: parcelInfoPda,
          asset: assetKeypair.publicKey,
          collection: gridConfig.collection,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([assetKeypair])
        .rpc();

      console.log(`    TX: ${tx}`);

      // Update D1 with the on-chain parcel ID
      console.log(`    Updating database...`);
      updateParcelOnChainId(parcel.id, expectedParcelId);

      console.log(`    Success!\n`);
      successCount++;
      results.push({ dbId: parcel.id, onChainId: expectedParcelId });

      // Small delay between transactions to avoid rate limiting
      await sleep(500);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`    Error: ${errorMsg}`);
      console.log(`    Failed!\n`);
      failCount++;
      results.push({ dbId: parcel.id, onChainId: null, error: errorMsg });
    }
  }

  // Summary
  const skipped = results.filter(r => r.error === "Skipped by user");
  const failed = results.filter(r => r.error && r.error !== "Skipped by user");

  console.log("===========================================");
  console.log("  Summary");
  console.log("===========================================\n");
  console.log(`Total parcels: ${parcels.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed parcels:");
    for (const r of failed) {
      console.log(`  - ${r.dbId}: ${r.error}`);
    }
  }

  // Final balance
  const finalBalance = await provider.connection.getBalance(authority.publicKey);
  const spent = (balance - finalBalance) / 1e9;
  console.log(`\nSOL spent: ${spent.toFixed(6)} SOL`);
  console.log(`Final balance: ${(finalBalance / 1e9).toFixed(6)} SOL`);
}

main().catch(console.error);
