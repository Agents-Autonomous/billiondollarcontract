import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import {
  createCollectionV1,
  createV1,
  addCollectionPluginV1,
  ruleSet,
  plugin,
} from "@metaplex-foundation/mpl-core";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";
import * as fs from "fs";
import * as path from "path";

// ============================================
// CONFIGURATION
// ============================================

// Mainnet RPC
const RPC_URL =
  "https://mainnet.helius-rpc.com/?api-key=82ef2bd1-98fa-4bf6-af02-58d9577701b5";

// Path to keypair file
const KEYPAIR_PATH =
  process.env.ANCHOR_WALLET ||
  path.join(process.env.HOME || "~", ".config/solana/id.json");

// Collection metadata - PRODUCTION URLs
const COLLECTION_NAME = "Billeon Doolars Bern Club";
const COLLECTION_SYMBOL = "BDBC";
const COLLECTION_URI =
  "https://million-dollar-api.seva-e96.workers.dev/collection";

// NFT metadata for initial mint
const PARCEL_ID = 10001;
const NFT_NAME = `Parcel #${PARCEL_ID}`;
const NFT_URI = `https://million-dollar-api.seva-e96.workers.dev/parcel/${PARCEL_ID}`;

// Royalty configuration - 5% to specified address
const ROYALTY_PERCENT = 5;
const ROYALTY_RECIPIENT = new PublicKey("BdBdevmuov29CegxHFmmH911DuNM5B7LrWEHsiqPRi8w");

// ============================================
// MAIN SCRIPT
// ============================================

async function main() {
  console.log("===========================================");
  console.log("  BDBC Collection Deployment - Mainnet");
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

  const recipientUmi = publicKey(ROYALTY_RECIPIENT.toBase58());

  // ============================================
  // Step 1: Create Collection with Royalties
  // ============================================
  console.log("Step 1: Creating BDBC Collection with Royalties...");
  console.log("   Name:", COLLECTION_NAME);
  console.log("   Symbol:", COLLECTION_SYMBOL);
  console.log("   URI:", COLLECTION_URI);
  console.log("   Royalty:", ROYALTY_PERCENT + "% to", ROYALTY_RECIPIENT.toBase58());
  console.log("   Update Authority: YOU (deployer)");

  const collectionSigner = generateSigner(umi);
  console.log("   Collection Address:", collectionSigner.publicKey.toString());

  const balanceBefore = await connection.getBalance(payer.publicKey);

  // Royalty is in basis points (5% = 500 basis points)
  const royaltyBasisPoints = ROYALTY_PERCENT * 100;

  await createCollectionV1(umi, {
    collection: collectionSigner,
    name: COLLECTION_NAME,
    uri: COLLECTION_URI,
    updateAuthority: umiKeypair.publicKey,
  }).sendAndConfirm(umi);

  console.log("   ✓ Collection created!\n");

  // ============================================
  // Step 2: Add Royalty Plugin
  // ============================================
  console.log("Step 2: Adding Royalty Plugin...");
  console.log("   Royalty:", ROYALTY_PERCENT + "%");
  console.log("   Recipient:", ROYALTY_RECIPIENT.toBase58());

  await addCollectionPluginV1(umi, {
    collection: collectionSigner.publicKey,
    plugin: plugin("Royalties", [
      {
        basisPoints: royaltyBasisPoints,
        creators: [
          {
            address: recipientUmi,
            percentage: 100,
          },
        ],
        ruleSet: ruleSet("None"),
      },
    ]),
  }).sendAndConfirm(umi);

  const balanceAfterCollection = await connection.getBalance(payer.publicKey);
  console.log(
    "   Cost:",
    ((balanceBefore - balanceAfterCollection) / 1e9).toFixed(6),
    "SOL"
  );
  console.log("   ✓ Royalty plugin added!\n");

  // ============================================
  // Step 3: Mint NFT #10001
  // ============================================
  console.log("Step 3: Minting NFT #10001...");
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
    owner: umiKeypair.publicKey,
  }).sendAndConfirm(umi);

  const balanceAfterMint = await connection.getBalance(payer.publicKey);
  console.log(
    "   Cost:",
    ((balanceAfterCollection - balanceAfterMint) / 1e9).toFixed(6),
    "SOL"
  );
  console.log("   ✓ NFT #10001 minted!\n");

  // ============================================
  // Summary
  // ============================================
  console.log("===========================================");
  console.log("  Deployment Complete!");
  console.log("===========================================\n");

  console.log("Collection Address:", collectionSigner.publicKey.toString());
  console.log("Collection Symbol: ", COLLECTION_SYMBOL);
  console.log("NFT Asset Address: ", assetSigner.publicKey.toString());
  console.log("Update Authority:  ", payer.publicKey.toBase58(), "(you)");
  console.log("Royalty:           ", ROYALTY_PERCENT + "% (" + royaltyBasisPoints + " basis points)");
  console.log("Royalty Recipient: ", ROYALTY_RECIPIENT.toBase58());
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
    `NFT #10001: https://explorer.solana.com/address/${assetSigner.publicKey.toString()}`
  );

  console.log("\n-------------------------------------------");
  console.log("IMPORTANT: Save these addresses!");
  console.log("Collection:", collectionSigner.publicKey.toString());
  console.log("-------------------------------------------\n");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
