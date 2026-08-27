// ============================================================================
//  Currency configuration — the SINGLE source of truth for what is tracked.
//
//  To ADD a currency:    add an object below with the correct ISO 4217 code.
//  To REMOVE a currency:  delete its object (or set active: false).
//  To change card layout: toggle "card: true/false".
//
//  After editing, run:  npm run seed   (idempotent — safe to re-run).
//
//  display_unit: how many units to show in the "readable" conversion for
//  very-low-value currencies (e.g. 1,000 VND). Use 1 for normal currencies.
//  decimals:     display precision for "1 unit = ₹X".
//
//  NOTE: ISO 4217 codes are authoritative. Names below were corrected to the
//  official currency names (e.g. "Israeli New Shekel" = ILS, "UAE Dirham" =
//  AED). Do NOT confuse similarly named currencies (AED vs MAD, both
//  "Dirham"; RUB Ruble; etc.).
// ============================================================================

/** @typedef {{country:string, currency_name:string, iso_code:string,
 *   display_unit:number, decimals:number, card:boolean, active:boolean}} Currency */

/** @type {Currency[]} */
export const TRACKED_CURRENCIES = [
  { country: 'Vietnam',              currency_name: 'Vietnamese Dong',        iso_code: 'VND', display_unit: 1000, decimals: 6, card: true,  active: true },
  { country: 'Bahrain',              currency_name: 'Bahraini Dinar',         iso_code: 'BHD', display_unit: 1,    decimals: 4, card: true,  active: true },
  { country: 'United Arab Emirates', currency_name: 'UAE Dirham',             iso_code: 'AED', display_unit: 1,    decimals: 4, card: true,  active: true },
  { country: 'Tanzania',             currency_name: 'Tanzanian Shilling',     iso_code: 'TZS', display_unit: 100,  decimals: 6, card: false, active: true },
  { country: 'Kyrgyzstan',           currency_name: 'Kyrgyzstani Som',        iso_code: 'KGS', display_unit: 1,    decimals: 4, card: false, active: true },
  { country: 'Armenia',              currency_name: 'Armenian Dram',          iso_code: 'AMD', display_unit: 10,   decimals: 5, card: false, active: true },
  { country: 'Israel',               currency_name: 'Israeli New Shekel',     iso_code: 'ILS', display_unit: 1,    decimals: 4, card: true,  active: true },
  { country: 'Morocco',              currency_name: 'Moroccan Dirham',        iso_code: 'MAD', display_unit: 1,    decimals: 4, card: false, active: true },
  { country: 'Turkey',               currency_name: 'Turkish Lira',           iso_code: 'TRY', display_unit: 1,    decimals: 4, card: true,  active: true },
  { country: 'Indonesia',            currency_name: 'Indonesian Rupiah',      iso_code: 'IDR', display_unit: 10000,decimals: 6, card: true,  active: true },
  { country: 'Georgia',              currency_name: 'Georgian Lari',          iso_code: 'GEL', display_unit: 1,    decimals: 4, card: false, active: true },
  { country: 'Cambodia',             currency_name: 'Cambodian Riel',         iso_code: 'KHR', display_unit: 1000, decimals: 6, card: false, active: true },
  { country: 'Egypt',                currency_name: 'Egyptian Pound',         iso_code: 'EGP', display_unit: 1,    decimals: 4, card: true,  active: true },
  { country: 'Russia',               currency_name: 'Russian Ruble',          iso_code: 'RUB', display_unit: 1,    decimals: 4, card: true,  active: true },

  // ---- Optional benchmark / reference currencies -------------------------
  // Shown as reference rates. Remove if not wanted.
  { country: 'United States',        currency_name: 'US Dollar',              iso_code: 'USD', display_unit: 1,    decimals: 4, card: false, active: true, reference: true },
  { country: 'Eurozone',             currency_name: 'Euro',                   iso_code: 'EUR', display_unit: 1,    decimals: 4, card: false, active: true, reference: true },
];

// The base currency. Everything is expressed as "1 foreign = X BASE".
export const BASE_CURRENCY = process.env.BASE_CURRENCY || 'INR';

// Which codes are "reference/benchmark" (not core tracked list).
export const REFERENCE_CODES = TRACKED_CURRENCIES
  .filter((c) => c.reference)
  .map((c) => c.iso_code);

// Core (non-reference) tracked codes — the "14 currencies".
export const CORE_CODES = TRACKED_CURRENCIES
  .filter((c) => !c.reference && c.active)
  .map((c) => c.iso_code);

// All active codes we request from the provider (excluding the base itself).
export const ALL_REQUEST_CODES = TRACKED_CURRENCIES
  .filter((c) => c.active && c.iso_code !== BASE_CURRENCY)
  .map((c) => c.iso_code);

export function getCurrencyMeta(code) {
  return TRACKED_CURRENCIES.find((c) => c.iso_code === code);
}
