use anchor_lang::prelude::*;

pub const LAND_BUY_REWARD_POOL_SEED: &[u8] = b"land_buy_reward_pool";

#[account]
#[derive(InitSpace)]
pub struct GridConfig {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub block_map: Pubkey,  // Address of the BlockMap account (not a PDA due to 10KB CPI limit)
    pub collection: Pubkey, // Metaplex Core collection address for parcel NFTs
    pub price_per_block: u64,
    pub total_burned: u64,
    #[max_len(10)]
    pub ring_thresholds: Vec<u64>,
    pub next_parcel_id: u16,
    #[max_len(128)]
    pub uri_base: String,
    pub seeding_enabled: bool,
    pub bump: u8,
    /// Global accumulator for land buy rewards (scaled by 1e9 for precision)
    pub land_buy_rewards_per_block: u128,
    /// Sum of all blocks in claimed parcels
    pub total_claimed_blocks: u32,
    /// Basis points for land owner reward share (2000 = 20%)
    pub land_owners_reward_share_bps: u16,
    /// Token account holding claimable land buy rewards
    pub land_buy_reward_pool: Pubkey,
    pub _padding: [u8; 202], // Reduced by 8 to accommodate u128
}

impl GridConfig {
    pub const SEED: &'static [u8] = b"grid_config";
}
