export const passportFields = {
  name: "Product",
  assetType: "Product type",
  manufacturer: "Manufacturer",
  model: "Model",
  serialNumber: "Serial number",
  manufacturerStreet: "Manufacturer street",
  manufacturerZipcode: "Manufacturer postal code",
  manufacturerCityTown: "Manufacturer city",
  manufacturerNationalCode: "Manufacturer country",
  manufacturerArticleNumber: "Article number",
  orderCodeOfManufacturer: "Order code",
  ratedValue: "Rated value",
  ratedUnit: "Rated unit",
  lifecycleStage: "Lifecycle stage",
  aasVersion: "AAS revision",
} as const;
export const PASSPORT_DISCLAIMER =
  "Voluntary prototype passport. It is not, by itself, evidence of ESPR conformity, CE conformity, or compliance with a future product-group delegated act.";
export type PassportDocument = {
  title: string;
  fields: { key: string; label: string; value: string }[];
  reviewedGuidance: string | null;
  disclaimer: string;
  publishedAt: string | null;
  publicId?: string;
};
