use anchor_lang::prelude::*;

#[error_code]
pub enum BillionError {
    #[msg("Block is already claimed")]
    BlockAlreadyClaimed,

    #[msg("Block is in a locked ring")]
    RingLocked,

    #[msg("Block coordinates out of bounds")]
    OutOfBounds,

    #[msg("Invalid parcel dimensions")]
    InvalidDimensions,

    #[msg("Insufficient token balance")]
    InsufficientBalance,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Seeding is disabled")]
    SeedingDisabled,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Collection not set")]
    CollectionNotSet,

    #[msg("Invalid collection")]
    InvalidCollection,

    #[msg("Asset does not match parcel")]
    AssetMismatch,

    #[msg("Invalid reward pool")]
    InvalidRewardPool,

    #[msg("Caller does not own this parcel")]
    NotOwner,

    #[msg("Nothing to claim")]
    NothingToClaim,

    #[msg("Invalid Core asset data")]
    InvalidCoreAsset,
}
