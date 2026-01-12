use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ParcelInfo {
    /// Metaplex Core NFT address
    pub asset: Pubkey,
    /// Top-left X coordinate
    pub x: u8,
    /// Top-left Y coordinate
    pub y: u8,
    /// Width in blocks
    pub width: u8,
    /// Height in blocks
    pub height: u8,
    /// PDA bump seed
    pub bump: u8,
    /// Snapshot of land_buy_rewards_per_block at last claim
    pub last_claimed_land_buy_rewards_per_block: u128,
    /// Reserved for future fields
    pub _reserved: [u8; 48], // Reduced by 8 to accommodate u128
}

impl ParcelInfo {
    pub const SEED: &'static [u8] = b"parcel";

    /// Calculate the number of blocks in this parcel
    pub fn block_count(&self) -> u32 {
        (self.width as u32) * (self.height as u32)
    }
}
