import { Keypair, Connection } from "@solana/web3.js";
import { createCollectionV1, createV1 } from "@metaplex-foundation/mpl-core";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, keypairIdentity } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import * as fs from "fs";
import * as path from "path";

// ============================================
// CONFIGURATION
// ============================================

// Use mainnet RPC - you can override with ANCHOR_PROVIDER_URL env var
const RPC_URL =
  "https://mainnet.helius-rpc.com/?api-key=82ef2bd1-98fa-4bf6-af02-58d9577701b5";

// Path to your keypair file (default: ~/.config/solana/id.json)
const KEYPAIR_PATH =
  process.env.ANCHOR_WALLET ||
  path.join(process.env.HOME || "~", ".config/solana/id.json");

// Collection metadata
const COLLECTION_NAME = "Billeon Doolars Bern Club";
const COLLECTION_URI =
  "https://million-dollar-api-staging.seva-e96.workers.dev/collection";

// NFT metadata for test mint
const TEST_PARCEL_ID = 100002;
const NFT_NAME = `Test Parcel #${TEST_PARCEL_ID}`;
const NFT_URI = `https://million-dollar-api-staging.seva-e96.workers.dev/parcel${TEST_PARCEL_ID}`;

// ============================================
// MAIN SCRIPT
// ============================================

async function main() {
  console.log("===========================================");
  console.log("  Metaplex Core Collection Test - Mainnet");
  console.log("===========================================\n");

  // Load keypair
  console.log("Loading keypair from:", KEYPAIR_PATH);
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log("Deployer:", payer.publicKey.toBase58());

  // Setup connection and check balance
  const connection = new Connection(RPC_URL, "confirmed");
  console.log("RPC:", RPC_URL);

  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / 1e9, "SOL\n");

  if (balance < 0.05 * 1e9) {
    console.error("Insufficient balance. Need at least 0.05 SOL.");
    process.exit(1);
  }

  // Setup UMI
  const umi = createUmi(RPC_URL);
  const umiKeypair = fromWeb3JsKeypair(payer);
  umi.use(keypairIdentity(umiKeypair));

  // ============================================
  // Step 1: Create Collection
  // ============================================
  console.log("Step 1: Creating Metaplex Core Collection...");
  console.log("   Name:", COLLECTION_NAME);
  console.log("   URI:", COLLECTION_URI);
  console.log("   Update Authority: YOU (deployer)");

  const collectionSigner = generateSigner(umi);
  console.log("   Collection Address:", collectionSigner.publicKey.toString());

  const balanceBefore = await connection.getBalance(payer.publicKey);

  await createCollectionV1(umi, {
    collection: collectionSigner,
    name: COLLECTION_NAME,
    uri: COLLECTION_URI,
    updateAuthority: umiKeypair.publicKey, // YOU are the update authority
  }).sendAndConfirm(umi);

  const balanceAfterCollection = await connection.getBalance(payer.publicKey);
  console.log(
    "   Cost:",
    ((balanceBefore - balanceAfterCollection) / 1e9).toFixed(6),
    "SOL"
  );
  console.log("   ✓ Collection created!\n");

  // ============================================
  // Step 2: Mint NFT to yourself
  // ============================================
  console.log("Step 2: Minting test NFT to yourself...");
  console.log("   Name:", NFT_NAME);
  console.log("   URI:", NFT_URI);
  console.log("   Owner: YOU (deployer)");

  const assetSigner = generateSigner(umi);
  console.log("   Asset Address:", assetSigner.publicKey.toString());

  await createV1(umi, {
    asset: assetSigner,
    collection: collectionSigner.publicKey,
    name: NFT_NAME,
    uri: NFT_URI,
    owner: umiKeypair.publicKey, // YOU own the NFT
  }).sendAndConfirm(umi);

  const balanceAfterMint = await connection.getBalance(payer.publicKey);
  console.log(
    "   Cost:",
    ((balanceAfterCollection - balanceAfterMint) / 1e9).toFixed(6),
    "SOL"
  );
  console.log("   ✓ NFT minted!\n");

  // ============================================
  // Summary
  // ============================================
  console.log("===========================================");
  console.log("  Test Complete!");
  console.log("===========================================\n");

  console.log("Collection Address:", collectionSigner.publicKey.toString());
  console.log("NFT Asset Address: ", assetSigner.publicKey.toString());
  console.log("Update Authority:  ", payer.publicKey.toBase58(), "(you)");
  console.log(
    "Total Cost:        ",
    ((balanceBefore - balanceAfterMint) / 1e9).toFixed(6),
    "SOL"
  );

  console.log("\nView on Solana Explorer:");
  console.log(
    `Collection: https://explorer.solana.com/address/${collectionSigner.publicKey.toString()}`
  );
  console.log(
    `NFT:        https://explorer.solana.com/address/${assetSigner.publicKey.toString()}`
  );

  console.log("\n-------------------------------------------");
  console.log("IMPORTANT: You are the update authority.");
  console.log("When ready, you can transfer authority to your PDA using:");
  console.log("  updateCollectionV1(umi, {");
  console.log("    collection: collectionSigner.publicKey,");
  console.log("    newUpdateAuthority: <your_pda>,");
  console.log("  })");
  console.log("-------------------------------------------\n");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
