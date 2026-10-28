export const ENV = {
  appId: process.env.VITE_APP_ID ?? "smart-factory",
  cookieSecret: process.env.JWT_SECRET ?? "default-secret-change-me",
  databaseUrl:
    process.env.DATABASE_URL ??
    (process.env.NODE_ENV === "development"
      ? "postgres://postgres:postgres@localhost:5432/smart_factory_iot"
      : ""),
  isProduction: process.env.NODE_ENV === "production",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "owner",
};
