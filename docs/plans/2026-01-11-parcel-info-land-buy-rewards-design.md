# ParcelInfo & Land Buy Rewards Design

## Overview

Add on-chain storage for parcel metadata and implement a reward distribution system where 20% of land purchase costs go to existing landowners proportionally.

## Problem

Currently, `BlockMap` stores only `parcel_id` (u16) per block. The NFT address is generated client-side and not stored on-chain, making it impossible to:
1. Look up NFT address from parcel_id
2. Verify parcel ownership on-chain
3. Distribute rewards to landowners

## Solution

### 1. ParcelInfo PDA

Store parcel metadata in a PDA derived from parcel_id:

```rust
// programs/billion/src/state/parcel_info.rs

use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ParcelInfo {
    pub asset: Pubkey,                              // Metaplex Core NFT address
    pub x: u8,                                      // Top-left X coordinate
    pub y: u8,                                      // Top-left Y coordinate
    pub width: u8,                                  // Width in blocks
    pub height: u8,                                 // Height in blocks
    pub bump: u8,                                   // PDA bump seed
    pub last_claimed_land_buy_rewards_per_block: u64, // Snapshot at last claim
    pub _reserved: [u8; 56],                        // Reserved for future fields
}

impl ParcelInfo {
    pub const SEED: &'static [u8] = b"parcel";

    pub fn block_count(&self) -> u32 {
        (self.width as u32) * (self.height as u32)
    }
}
```

**PDA derivation:** `seeds = [ParcelInfo::SEED, &parcel_id.to_le_bytes()]`

**Account size:** 8 + 32 + 1 + 1 + 1 + 1 + 1 + 8 + 56 = 109 bytes (~0.0015 SOL rent)

### 2. GridConfig Additions

```rust
pub struct GridConfig {
    // ... existing fields ...

    pub land_buy_rewards_per_block: u64,      // Global accumulator (scaled by 1e9)
    pub total_claimed_blocks: u32,            // Sum of all blocks in claimed parcels
    pub land_owners_reward_share_bps: u16,    // Basis points (2000 = 20%)
    pub land_buy_reward_pool: Pubkey,         // Token account holding claimable rewards
}
```

### 3. Land Buy Reward Pool

PDA token account holding accumulated rewards:

```rust
pub const LAND_BUY_REWARD_POOL_SEED: &[u8] = b"land_buy_reward_pool";

// Derive: [LAND_BUY_REWARD_POOL_SEED, grid_config.key().as_ref()]
```

Initialized in `initialize` instruction, controlled by GridConfig PDA.

## Token Flow

When a user claims land:

```
User pays 100 tokens (price_per_block * num_blocks)
    ├── 80 tokens → burned (removed from supply)
    └── 20 tokens → transferred to land_buy_reward_pool
                    └── distributed proportionally to existing landowners
```

## Reward Distribution Mechanism

Uses a **global accumulator pattern** for O(1) distribution:

**On land purchase:**
```
reward_amount = total_cost * land_owners_reward_share_bps / 10000
land_buy_rewards_per_block += (reward_amount * 1e9) / total_claimed_blocks
```

**On reward claim:**
```
owed = parcel.block_count * (global_rewards_per_block - parcel.last_claimed) / 1e9
parcel.last_claimed = global_rewards_per_block
transfer(owed)
```

New parcels start with `last_claimed = current global value`, so they don't claim past rewards.

## Instruction Changes

### `initialize`

- Create `land_buy_reward_pool` token account
- Initialize new GridConfig fields:
  - `land_buy_rewards_per_block = 0`
  - `total_claimed_blocks = 0`
  - `land_owners_reward_share_bps` (from args)
  - `land_buy_reward_pool` (from created account)

### `claim_parcel`

1. Calculate split: `reward_amount` (20%) and `burn_amount` (80%)
2. Transfer `reward_amount` to `land_buy_reward_pool`
3. Burn `burn_amount`
4. Update accumulator if `total_claimed_blocks > 0`
5. Update `total_claimed_blocks`
6. Create `ParcelInfo` PDA with current snapshot

**New accounts:**
- `parcel_info: Account<'info, ParcelInfo>` (init)
- `land_buy_reward_pool: InterfaceAccount<'info, InterfaceTokenAccount>` (mut)

### `admin_mint`

1. Update `total_claimed_blocks`
2. Create `ParcelInfo` PDA with current snapshot

**New accounts:**
- `parcel_info: Account<'info, ParcelInfo>` (init)

Note: No reward distribution since no tokens are burned.

### `claim_land_buy_rewards` (NEW)

```rust
#[derive(Accounts)]
#[instruction(parcel_id: u16)]
pub struct ClaimLandBuyRewards<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(seeds = [GridConfig::SEED], bump = grid_config.bump)]
    pub grid_config: Account<'info, GridConfig>,

    #[account(
        mut,
        seeds = [ParcelInfo::SEED, &parcel_id.to_le_bytes()],
        bump = parcel_info.bump
    )]
    pub parcel_info: Account<'info, ParcelInfo>,

    /// CHECK: Validated by constraint, ownership checked in handler
    #[account(constraint = asset.key() == parcel_info.asset @ BillionError::AssetMismatch)]
    pub asset: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = land_buy_reward_pool.key() == grid_config.land_buy_reward_pool
    )]
    pub land_buy_reward_pool: InterfaceAccount<'info, InterfaceTokenAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = claimer,
        associated_token::token_program = token_program,
    )]
    pub claimer_token_account: InterfaceAccount<'info, InterfaceTokenAccount>,

    pub token_mint: InterfaceAccount<'info, InterfaceMint>,
    pub token_program: Interface<'info, TokenInterface>,
}
```

**Handler logic:**
1. Parse Core asset to verify `claimer` is current owner
2. Calculate `owed = block_count * (global - last_claimed) / 1e9`
3. Update `last_claimed_land_buy_rewards_per_block`
4. Transfer from pool to claimer (signed by GridConfig PDA)

### `update_config`

- Add ability to update `land_owners_reward_share_bps`

## New Errors

```rust
#[error_code]
pub enum BillionError {
    // ... existing ...

    #[msg("Asset does not match parcel")]
    AssetMismatch,

    #[msg("Invalid reward pool")]
    InvalidRewardPool,

    #[msg("Caller does not own this parcel")]
    NotOwner,

    #[msg("Nothing to claim")]
    NothingToClaim,
}
```

## Files to Create

- `programs/billion/src/state/parcel_info.rs`
- `programs/billion/src/instructions/claim_land_buy_rewards.rs`

## Files to Modify

- `programs/billion/src/state/mod.rs` - export ParcelInfo
- `programs/billion/src/state/grid_config.rs` - add new fields
- `programs/billion/src/instructions/mod.rs` - export new instruction
- `programs/billion/src/instructions/initialize.rs` - init reward pool & new fields
- `programs/billion/src/instructions/claim_parcel.rs` - create ParcelInfo, split tokens
- `programs/billion/src/instructions/admin_mint.rs` - create ParcelInfo, update blocks
- `programs/billion/src/instructions/update_config.rs` - allow updating reward share bps
- `programs/billion/src/lib.rs` - add claim_land_buy_rewards entrypoint
- `programs/billion/src/errors.rs` - add new error variants

## Testing Plan

### Fix Existing Tests

Update existing tests to account for new required accounts and fields:

- `initialize` tests - add reward pool creation, new config fields
- `claim_parcel` tests - add parcel_info and reward_pool accounts
- `admin_mint` tests - add parcel_info account
- `update_config` tests - add reward share bps update

### New Tests

#### ParcelInfo Tests

- `test_parcel_info_created_on_claim` - verify ParcelInfo PDA created with correct data
- `test_parcel_info_created_on_admin_mint` - verify ParcelInfo PDA created for admin mint
- `test_parcel_info_correct_geometry` - verify x, y, width, height stored correctly
- `test_parcel_info_asset_matches_nft` - verify asset pubkey matches created NFT

#### Reward Distribution Tests

- `test_reward_split_20_80` - verify 20% goes to pool, 80% burned
- `test_rewards_accumulator_increases` - verify `land_buy_rewards_per_block` increases on claim
- `test_first_parcel_no_rewards` - first parcel has no one to distribute to
- `test_second_parcel_rewards_first` - second claim distributes to first parcel owner
- `test_rewards_proportional_to_blocks` - larger parcels get proportionally more rewards
- `test_configurable_reward_share` - test different bps values (1000, 2000, 5000)

#### Claim Rewards Tests

- `test_claim_land_buy_rewards_success` - happy path claim
- `test_claim_rewards_ownership_check` - non-owner cannot claim
- `test_claim_rewards_after_nft_transfer` - new owner can claim, old owner cannot
- `test_claim_rewards_nothing_to_claim` - error when no rewards available
- `test_claim_rewards_updates_checkpoint` - last_claimed updated after claim
- `test_claim_rewards_multiple_claims` - can claim multiple times as rewards accumulate
- `test_claim_rewards_correct_amount` - verify math: blocks * delta / 1e9

#### Edge Cases

- `test_zero_reward_share` - 0 bps means no rewards distributed
- `test_max_reward_share` - 10000 bps means all goes to rewards, nothing burned
- `test_many_parcels_precision` - verify no precision loss with many small parcels
- `test_admin_mint_no_reward_distribution` - admin mint doesn't trigger reward distribution

## Account Costs

- ParcelInfo: ~0.0015 SOL per parcel (paid by claimer/admin)
- Reward pool: ~0.002 SOL one-time (paid during initialize)
