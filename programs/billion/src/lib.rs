use anchor_lang::prelude::*;

pub mod errors;
pub mod state;
pub mod utils;
pub mod instructions;

use instructions::*;

declare_id!("BDBCR33yBuWjGJiGXoApW3qR9ajP2fGSJfzTP6SbYn6h");

#[program]
pub mod billion {
    use super::*;

    pub fn create_block_map(ctx: Context<CreateBlockMap>) -> Result<()> {
        instructions::create_block_map::handler(ctx)
    }

    pub fn initialize(
        ctx: Context<Initialize>,
        price_per_block: u64,
        ring_thresholds: Vec<u64>,
        uri_base: String,
        land_owners_reward_share_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, price_per_block, ring_thresholds, uri_base, land_owners_reward_share_bps)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        price_per_block: Option<u64>,
        ring_thresholds: Option<Vec<u64>>,
        uri_base: Option<String>,
        seeding_enabled: Option<bool>,
        collection: Option<Pubkey>,
        land_owners_reward_share_bps: Option<u16>,
        total_burned: Option<u64>,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, price_per_block, ring_thresholds, uri_base, seeding_enabled, collection, land_owners_reward_share_bps, total_burned)
    }

    pub fn claim_parcel(
        ctx: Context<ClaimParcel>,
        x: u8,
        y: u8,
        width: u8,
        height: u8,
    ) -> Result<()> {
        instructions::claim_parcel::handler(ctx, x, y, width, height)
    }

    pub fn admin_mint(
        ctx: Context<AdminMint>,
        x: u8,
        y: u8,
        width: u8,
        height: u8,
    ) -> Result<()> {
        instructions::admin_mint::handler(ctx, x, y, width, height)
    }

    pub fn update_parcel_metadata(
        ctx: Context<UpdateParcelMetadata>,
        new_name: Option<String>,
        new_uri: Option<String>,
    ) -> Result<()> {
        instructions::update_parcel_metadata::handler(ctx, new_name, new_uri)
    }

    pub fn claim_land_buy_rewards(
        ctx: Context<ClaimLandBuyRewards>,
        parcel_id: u16,
    ) -> Result<()> {
        instructions::claim_land_buy_rewards::handler(ctx, parcel_id)
    }

    pub fn admin_close_parcel_info(
        ctx: Context<AdminCloseParcelInfo>,
        parcel_id: u16,
    ) -> Result<()> {
        instructions::admin_close_parcel_info::handler(ctx, parcel_id)
    }

    pub fn admin_purge(ctx: Context<AdminPurge>) -> Result<()> {
        instructions::admin_purge::handler(ctx)
    }

    pub fn admin_transfer_nft_collection_authority(
        ctx: Context<AdminTransferNftCollectionAuthority>,
    ) -> Result<()> {
        instructions::admin_transfer_nft_collection_authority::handler(ctx)
    }
}
