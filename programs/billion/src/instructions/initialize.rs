use anchor_lang::prelude::*;
use anchor_spl::{
    token_interface::{Mint, TokenAccount, TokenInterface},
    associated_token::AssociatedToken,
};
use crate::state::{GridConfig, BlockMap, LAND_BUY_REWARD_POOL_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Token mint - supports both Token and Token-2022
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + GridConfig::INIT_SPACE,
        seeds = [GridConfig::SEED],
        bump
    )]
    pub grid_config: Account<'info, GridConfig>,

    /// BlockMap must be created first via create_block_map instruction.
    /// Not a PDA - uses keypair account due to 10KB CPI limit for large accounts.
    #[account(mut)]
    pub block_map: AccountLoader<'info, BlockMap>,

    /// Land buy reward pool - holds tokens to be distributed to landowners
    #[account(
        init,
        payer = authority,
        seeds = [LAND_BUY_REWARD_POOL_SEED, grid_config.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = grid_config,
        token::token_program = token_program,
    )]
    pub land_buy_reward_pool: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    price_per_block: u64,
    ring_thresholds: Vec<u64>,
    uri_base: String,
    land_owners_reward_share_bps: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.grid_config;

    config.authority = ctx.accounts.authority.key();
    config.token_mint = ctx.accounts.token_mint.key();
    config.block_map = ctx.accounts.block_map.key();
    config.collection = Pubkey::default();  // Set to default, will be updated via update_config
    config.price_per_block = price_per_block;
    config.total_burned = 0;
    config.ring_thresholds = ring_thresholds;
    config.next_parcel_id = 1; // 0 means unclaimed
    config.uri_base = uri_base;
    config.seeding_enabled = true;
    config.bump = ctx.bumps.grid_config;

    // Land buy rewards initialization
    config.land_buy_rewards_per_block = 0;
    config.total_claimed_blocks = 0;
    config.land_owners_reward_share_bps = land_owners_reward_share_bps;
    config.land_buy_reward_pool = ctx.accounts.land_buy_reward_pool.key();
    config._padding = [0u8; 202];

    // BlockMap is already initialized by create_block_map instruction
    // blocks array is already zeroed from account creation

    msg!(
        "Grid initialized with price {} per block, reward share {}bps",
        price_per_block,
        land_owners_reward_share_bps
    );
    Ok(())
}
