use anchor_lang::prelude::*;

use crate::errors::BillionError;
use crate::state::{GridConfig, ParcelInfo};

#[derive(Accounts)]
#[instruction(parcel_id: u16)]
pub struct AdminCloseParcelInfo<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [GridConfig::SEED],
        bump = grid_config.bump,
        has_one = authority @ BillionError::Unauthorized,
    )]
    pub grid_config: Account<'info, GridConfig>,

    #[account(
        mut,
        seeds = [ParcelInfo::SEED, &parcel_id.to_le_bytes()],
        bump = parcel_info.bump,
        close = authority,
    )]
    pub parcel_info: Account<'info, ParcelInfo>,
}

pub fn handler(_ctx: Context<AdminCloseParcelInfo>, _parcel_id: u16) -> Result<()> {
    // Account is closed automatically by the `close = authority` constraint
    msg!("Closed ParcelInfo for parcel_id: {}", _parcel_id);
    Ok(())
}
