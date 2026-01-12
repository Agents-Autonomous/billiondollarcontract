use anchor_lang::prelude::*;
use crate::state::GridConfig;
use crate::errors::BillionError;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        constraint = authority.key() == grid_config.authority @ BillionError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GridConfig::SEED],
        bump = grid_config.bump
    )]
    pub grid_config: Account<'info, GridConfig>,
}

pub fn handler(
    ctx: Context<UpdateConfig>,
    price_per_block: Option<u64>,
    ring_thresholds: Option<Vec<u64>>,
    uri_base: Option<String>,
    seeding_enabled: Option<bool>,
    collection: Option<Pubkey>,
    land_owners_reward_share_bps: Option<u16>,
    total_burned: Option<u64>,
) -> Result<()> {
    let config = &mut ctx.accounts.grid_config;

    if let Some(price) = price_per_block {
        config.price_per_block = price;
        msg!("Updated price_per_block to {}", price);
    }

    if let Some(thresholds) = ring_thresholds {
        config.ring_thresholds = thresholds;
        msg!("Updated ring_thresholds");
    }

    if let Some(uri) = uri_base {
        config.uri_base = uri;
        msg!("Updated uri_base");
    }

    if let Some(enabled) = seeding_enabled {
        config.seeding_enabled = enabled;
        msg!("Updated seeding_enabled to {}", enabled);
    }

    if let Some(coll) = collection {
        config.collection = coll;
        msg!("Updated collection to {}", coll);
    }

    if let Some(bps) = land_owners_reward_share_bps {
        config.land_owners_reward_share_bps = bps;
        msg!("Updated land_owners_reward_share_bps to {}", bps);
    }

    if let Some(burned) = total_burned {
        config.total_burned = burned;
        msg!("Updated total_burned to {}", burned);
    }

    Ok(())
}
