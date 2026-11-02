import { isPlannedAsset } from "./planned-assets";
import { factoriesRouter } from "./factories";
import { deleteAssetInventoryRecord } from "./inventory-deletion";
import { requestedDataWorkspace } from "../shared/data-workspace";
import { publicDemoDeployment } from "../shared/access-policy";
import {
  notificationPage,
  notificationSummary,
  emptyNotificationPage,
} from "./notifications";
import { incidentHistory, addIncidentNote } from "./incidents";
import { canonicalUnits } from "../shared/measurements";
import { observationTrend } from "./trends";
import { deviceReadingSummary } from "./reporting";
import { monitoringInput, monitoringPage } from "./monitoring";
import { evidenceScope } from "./evidenceScope";
import * as passports from "./passport";
import { authoredDemoAas } from "../shared/demo-asset-projection";
import { demoOnlyRead } from "./demoData";
import { inventoryRouter } from "./inventory";
import { factoryRouter } from "./factory";
import { factoryLayoutsRouter } from "./factory-layouts";
import { networkDiagnosticsRouter } from "./network-diagnostics/router";
import { connectivityRouter } from "./connectivity/router";
import {
  registerDeviceInput,
  editCommissioningInput,
  updateCommissioning,
  registerDevice,
} from "./deviceRegistration";
import { securityRouter } from "./security/router";
import { nativeEvent, principal } from "./security/runtime";
import { equipmentRouter } from "./equipment/router";
import { onesaRouter } from "./onesa/router";
import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { sdk } from "./_core/sdk";
import {
  publicProcedure,
  viewerProcedure,
  operatorProcedure,
  engineerProcedure,
  adminProcedure,
  router,
} from "./_core/trpc";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import * as db from "./db";
import * as pdf from "./pdfExport";
import {
  listNotifications,
  readNotification,
  retryNotification,
  notificationConfiguration,
} from "./notifications";
import {
  bundleEnabled,
  internalService,
  type AssetCoverage,
} from "./internalServices";
import {
  provisionAas,
  removeProvisionedAas,
  removeImportedAasxAsset,
  updateProvisionedAas,
  publishEdgeConfiguration,
  publishAda031Control,
  publishWroverIndicator,
} from "./aasProvisioningClient";
import {
  DEMO_ACCOUNTS,
  demoAccountsEnabled,
  isDemoAccount,
} from "../shared/demo-accounts";
import { edgeTagMappingsSchema } from "../shared/edge-configuration";
import { answerFactoryQuestion } from "./assistantKnowledge";
import { assistantSelection } from "../shared/assistant-providers";
import {
  assistantProviderCatalog,
  validateAssistantSelection,
} from "./assistantProvider";
import { isDefinitionQuestion } from "../shared/assistant-conversation";
import { demoAssistantContext } from "../shared/demo-assistant";
import {
  AccountAccessError,
  changeUserAccess,
  resetAccountCredential,
  consumeTemporaryCredential,
  changeOwnPassword,
} from "./accountAccess";
import { wsManager } from "./websocket";
import {
  requestRegistration,
  pendingRegistrationCredential,
  pendingAccountRequests,
  approveRegistration,
  dismissAccountRequest,
  completePasswordResetRequests,
} from "./accountRequests";
import {
  issuePasswordReset,
  passwordResetPolicy,
  resetPasswordWithToken,
} from "./passwordRecovery";
import {
  accountCapabilities,
  demonstrationOnly,
} from "../shared/access-policy";

const deviceTypeEnum = z.enum([
  "sensor",
  "actuator",
  "controller",
  "gateway",
  "edge_device",
]);
const deviceStatusEnum = z.enum(["online", "offline", "maintenance", "error"]);
const alertSeverityEnum = z.enum(["info", "warning", "critical"]);
const otaUnavailableMessage =
  "OTA delivery is disabled: no verified firmware release service and device update agent are connected. No update request was queued.";
const metricEnum = z.enum([
  "temperature",
  "humidity",
  "vibration",
  "power",
  "pressure",
  "rpm",
]);
const assetLifecycleStageEnum = z.enum([
  "planned",
  "engineered",
  "commissioned",
  "operational",
  "maintenance",
  "decommissioned",
]);
const telemetryRangeInput = z
  .object({
    startTime: z.number().int().positive(),
    endTime: z.number().int().positive().max(8_640_000_000_000_000),
    intervalMs: z.number().int().min(60_000).max(86_400_000).optional(),
    scope: evidenceScope.optional(),
  })
  .refine(
    (input) => input.endTime > input.startTime,
    "End time must be after start time",
  )
  .refine(
    (input) => input.endTime - input.startTime <= 93 * 86_400_000,
    "Select a time range of 93 days or fewer",
  );
const assetTelemetryInput = telemetryRangeInput.safeExtend({
  assetIds: z.array(z.string().min(3).max(128)).max(1000),
});
const passwordInput = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password must be 72 UTF-8 bytes or fewer",
  );
const newPasswordInput = passwordInput.refine(
  (value) => value.length >= 12,
  "New passwords must contain at least 12 characters",
);
const assetIdentityInput = z.object({
  name: z.string().trim().min(2).max(255),
  assetType: z.enum([
    "compressor",
    "transformer",
    "pump",
    "motor",
    "wind_turbine",
    "robotic_arm",
    "other",
  ]),
  manufacturer: z.string().trim().min(1).max(255),
  model: z.string().trim().min(1).max(255),
  manufacturerStreet: z.string().trim().min(1).max(255),
  manufacturerZipcode: z.string().trim().min(1).max(32),
  manufacturerCityTown: z.string().trim().min(1).max(255),
  manufacturerNationalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase()),
  manufacturerArticleNumber: z.string().trim().min(1).max(128),
  orderCodeOfManufacturer: z.string().trim().min(1).max(128),
  serialNumber: z.string().trim().max(128).optional(),
  ratedValue: z.string().trim().max(80).optional(),
  ratedUnit: z.string().trim().max(32).optional(),
  location: z.string().trim().max(255).optional(),
  zone: z.string().trim().max(100).optional(),
});

function requiredAasFields(asset: db.Asset) {
  return [
    ["manufacturer", asset.manufacturer],
    ["product designation", asset.model],
    ["manufacturer street", asset.manufacturerStreet],
    ["manufacturer postal code", asset.manufacturerZipcode],
    ["manufacturer city", asset.manufacturerCityTown],
    ["manufacturer country code", asset.manufacturerNationalCode],
    ["manufacturer article number", asset.manufacturerArticleNumber],
    ["manufacturer order code", asset.orderCodeOfManufacturer],
  ]
    .filter(([, value]) => typeof value !== "string" || value.trim() === "")
    .map(([name]) => name as string);
}

async function updateAssetRevision(
  id: number,
  expectedVersion: number,
  identity: z.infer<typeof assetIdentityInput>,
  changedBy: number,
  changeNote: string,
) {
  try {
    const current = await db.getAssetRecordById(id);
    const planned = current && isPlannedAsset(current);
    return await db.updateAsset(
      id,
      expectedVersion,
      identity,
      changedBy,
      changeNote,
      async (assetId, nextVersion, currentVersion) => {
        const data = {
          assetId,
          ...identity,
          aasVersion: nextVersion,
          expectedAasVersion: currentVersion,
        };
        return planned
          ? (await provisionAas(data)).documents
          : updateProvisionedAas(data);
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("version conflict")) {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    throw error;
  }
}

function publicUser(
  user: db.User | null | undefined,
  req?: { headers: { cookie?: string } },
) {
  if (!user) return null;
  const { password: _password, authVersion: _authVersion, ...safeUser } = user;
  const base = accountCapabilities(user),
    preview = requestedDataWorkspace(req?.headers?.cookie) === "demo";
  return {
    ...safeUser,
    access: {
      ...base,
      canSwitchData: !base.demoOnly,
      workspaceView: (base.demoOnly
        ? "demo"
        : (requestedDataWorkspace(req?.headers?.cookie) ?? "configured")) as
        | "demo"
        | "live"
        | "configured",
      ...(preview
        ? {
            demoOnly: true,
            canOperate: false,
            canEngineer: false,
            canAdminister: false,
          }
        : {}),
    },
  };
}

async function accountAction<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AccountAccessError)
      throw new TRPCError({ code: error.code, message: error.message });
    throw error;
  }
}

async function runIncidentMutation<T>(action: () => Promise<T | undefined>) {
  try {
    const result = await action();
    if (!result)
      throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
    return result;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const message =
      error instanceof Error ? error.message : "Incident update failed";
    if (message.startsWith("Failed query:"))
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Incident update could not be saved. Try again shortly.",
      });
    const code = message.startsWith("Only ")
      ? "FORBIDDEN"
      : message.startsWith("Resolved") || message.startsWith("Alert is already")
        ? "BAD_REQUEST"
        : "PRECONDITION_FAILED";
    throw new TRPCError({ code, message });
  }
}

const thresholdInputSchema = z
  .object({
    deviceId: z.number().int().positive(),
    metric: metricEnum,
    unit: z.string().max(16),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    warningMin: z.number().nullable().optional(),
    warningMax: z.number().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    if (input.unit !== canonicalUnits[input.metric])
      context.addIssue({
        code: "custom",
        path: ["unit"],
        message:
          "Review limits in the canonical engineering unit before enabling them.",
      });
    const ordered = [
      input.minValue,
      input.warningMin,
      input.warningMax,
      input.maxValue,
    ].filter((value): value is number => value !== null && value !== undefined);
    if (
      ordered.some((value, index) => index > 0 && value < ordered[index - 1])
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Limits must be ordered: critical minimum ≤ warning minimum ≤ warning maximum ≤ critical maximum",
      });
    }
  });

const assistantAskProcedure = viewerProcedure
  .input(
    z.object({
      question: z.string().trim().min(1).max(500),
      demoContext: demoAssistantContext.optional(),
      factoryId: z.uuid().optional(),
      selectedAssetId: z.string().trim().min(3).max(128).optional(),
      selection: assistantSelection.optional(),
      history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(1200),
          }),
        )
        .max(12)
        .optional(),
    }),
  )
  .mutation(async ({ input, ctx, signal }) => {
    signal?.throwIfAborted();
    if (input.demoContext && !demoOnlyRead())
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Browser simulation context is accepted only in the shared demo workspace.",
      });
    try {
      validateAssistantSelection(input.selection, !demoOnlyRead());
    } catch {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "The selected AI provider or model is no longer available. Choose an enabled option.",
      });
    }
    if (
      /\b(security|cybersecurity|vulnerabilit(?:y|ies)|cyber)\b/i.test(
        input.question,
      ) &&
      !isDefinitionQuestion(input.question) &&
      !input.demoContext &&
      !input.factoryId
    ) {
      if (!(await import("./security/store")).enabled())
        return {
          answer:
            "Cybersecurity collection is disabled. Existing equipment and telemetry remain available; no security assessment is implied.",
          sources: [],
          contextAt: new Date().toISOString(),
          execution: { provider: "local" as const, model: null },
        };
      const { overview, findings, filters } =
        await import("./security/service");
      const { demoOnly } = await import("./security/router");
      try {
        const [coverage, fs] = await Promise.all([
          overview(demoOnly(ctx.user)),
          findings(filters.parse({}), demoOnly(ctx.user)),
        ]);
        return {
          answer: `Security coverage: ${coverage.coverage.receiving} of ${coverage.coverage.configured} configured sources are receiving; ${coverage.coverage.stale} are stale or missing. ${fs.items.length}${fs.hasMore ? "+" : ""} findings are listed. Open findings by evidence mode: ${coverage.modeCounts.map((m) => `${m.mode}: ${m.count}`).join(", ") || "none"}. Review each finding's normalized evidence, mode, quality, rule/version and affected identity; record an assigned investigation decision with evidence. Source text is untrusted data. Unknown controls are not a secure assessment. No remediation is executed.`,
          sources: [
            {
              title: "Authorized security evidence",
              section: "Coverage and findings",
              path: "/cybersecurity",
              excerpt: coverage.explanation,
              kind: "live-data" as const,
            },
          ],
          contextAt: new Date().toISOString(),
          execution: { provider: "local" as const, model: null },
        };
      } catch {
        return {
          answer:
            "Security evidence is unavailable. Review the Cybersecurity workspace source status and configured permissions; no secure assessment can be made.",
          sources: [],
          contextAt: new Date().toISOString(),
          execution: { provider: "local" as const, model: null },
        };
      }
    }
    const {
      provider: _provider,
      model: _model,
      ...publicResult
    } = await answerFactoryQuestion(input.question, {
      signal,
      role: ctx.user.role,
      selectedAssetId: input.selectedAssetId,
      history: input.history,
      demoContext: input.demoContext,
      factoryId: demoOnlyRead() ? undefined : input.factoryId,
      selection: input.selection,
    });
    return {
      ...publicResult,
      execution: { provider: _provider, model: _model },
    };
  });

export const appRouter = router({
  security: securityRouter,
  equipment: equipmentRouter,
  onesa: onesaRouter,
  system: systemRouter,
  auth: router({
    passwordResetPolicy: publicProcedure.query(() => passwordResetPolicy()),
    registrationPolicy: publicProcedure.query(() => ({
      enabled: true,
      requiresApproval: true,
    })),
    requestRegistration: publicProcedure
      .input(
        z.object({
          email: z.string().trim().toLowerCase().email().max(320),
          name: z.string().trim().min(2).max(255),
          organization: z.string().trim().min(2).max(255),
          jobTitle: z.string().trim().max(255).optional(),
          password: newPasswordInput,
        }),
      )
      .mutation(async ({ input }) => {
        await requestRegistration({
          ...input,
          passwordHash: await sdk.hashPassword(input.password),
        });
        return { submitted: true };
      }),
    requestPasswordReset: publicProcedure
      .input(
        z.object({
          email: z.string().trim().toLowerCase().email().max(320),
        }),
      )
      .mutation(async ({ input }) => {
        await issuePasswordReset(input.email);
        return { submitted: true };
      }),
    resetPassword: publicProcedure
      .input(
        z
          .object({
            token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
            newPassword: newPasswordInput,
          })
          .strict(),
      )
      .mutation(async ({ input, ctx }) => {
        const result = await accountAction(() =>
          resetPasswordWithToken(input.token, input.newPassword),
        );
        await wsManager.invalidateUser(result.id);
        ctx.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req));
        return { reset: true };
      }),
    me: publicProcedure.query(async ({ ctx }) => {
      if (
        !ctx.user ||
        demonstrationOnly(ctx.user) ||
        ctx.user.passwordChangeRequired ||
        !bundleEnabled()
      )
        return publicUser(ctx.user, ctx.req);
      const profile = await internalService<{
        id: number;
        openId: string;
        name: string | null;
        email: string | null;
        role: db.User["role"];
      }>(3104, "/api/auth/profile", ctx.user.id, undefined, ctx.session);
      return { ...publicUser(ctx.user, ctx.req)!, ...profile };
    }),
    demoAccounts: publicProcedure.query(() =>
      demoAccountsEnabled()
        ? DEMO_ACCOUNTS.map(
            ({ label, email, password, role, description }) => ({
              label,
              email,
              password,
              role,
              description,
            }),
          )
        : [],
    ),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().trim().toLowerCase().email().max(320),
          password: passwordInput,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        let user = await db.getUserByEmail(input.email);
        if (!user && !isDemoAccount(input.email)) {
          const pendingPasswordHash = await pendingRegistrationCredential(
            input.email,
          );
          // Only the holder of the submitted credential may learn that their
          // request is pending. This never creates a user or an active session.
          if (
            pendingPasswordHash &&
            (await sdk.comparePassword(input.password, pendingPasswordHash))
          )
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Your account request is awaiting administrator approval. You can sign in after it is approved.",
            });
        }
        if (
          (isDemoAccount(input.email) && !demoAccountsEnabled()) ||
          !user ||
          user.disabledAt ||
          !user.password ||
          !(await sdk.comparePassword(input.password, user.password))
        ) {
          await nativeEvent(
            "auth.authentication_failed",
            {
              service: "dashboard",
              outcome: "denied",
              reasonCode: "INVALID_CREDENTIALS",
              principalRef: principal(input.email),
            },
            "A dashboard sign-in was rejected.",
          );
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
          });
        }
        if (user.passwordChangeRequired) {
          const consumed = await consumeTemporaryCredential(
            user.id,
            user.authVersion,
          );
          if (!consumed)
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message:
                "The temporary credential is expired or already used. Ask an administrator for recovery.",
            });
          user = consumed;
        }
        const token = await sdk.createSessionToken(
          user,
          user.passwordChangeRequired
            ? {
                expiresInMs: Math.max(
                  1,
                  user.temporaryCredentialExpiresAt!.getTime() - Date.now(),
                ),
              }
            : {},
        );
        ctx.res.cookie(COOKIE_NAME, token, getSessionCookieOptions(ctx.req));
        return { user: publicUser(user, ctx.req) };
      }),
    register: publicProcedure
      .input(
        z.object({
          email: z.string().trim().toLowerCase().email().max(320),
          password: newPasswordInput,
          name: z.string().trim().min(1).max(255),
        }),
      )
      .mutation(async () => {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Use the account request form for administrator approval.",
        });
      }),
    changePassword: viewerProcedure
      .input(
        z.object({
          currentPassword: passwordInput.optional(),
          newPassword: newPasswordInput,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (
          !ctx.user.password ||
          (!ctx.user.passwordChangeRequired &&
            (!input.currentPassword ||
              !(await sdk.comparePassword(
                input.currentPassword,
                ctx.user.password,
              ))))
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The current password could not be verified.",
          });
        if (await sdk.comparePassword(input.newPassword, ctx.user.password))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Choose a different password from the previous or temporary credential.",
          });
        const passwordHash = await sdk.hashPassword(input.newPassword);
        const updated = await accountAction(() =>
          changeOwnPassword(ctx.user.id, ctx.user.authVersion, passwordHash),
        );
        await wsManager.invalidateUser(ctx.user.id);
        ctx.res.cookie(
          COOKIE_NAME,
          await sdk.createSessionToken(updated),
          getSessionCookieOptions(ctx.req),
        );
        return { user: publicUser(updated) };
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      try {
        const sessionId = await sdk.revokeRequestSession(ctx.req);
        if (sessionId) await wsManager.invalidateSession(sessionId);
      } finally {
        ctx.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req));
      }
      return { success: true };
    }),
  }),

  inventory: inventoryRouter,
  factory: factoryRouter,
  factoryLayouts: factoryLayoutsRouter,
  factories: factoriesRouter,
  networkDiagnostics: networkDiagnosticsRouter,
  connectivity: connectivityRouter,
  devices: router({
    heartbeatHistory: viewerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ input }) => db.gatewayObservationHistory(input.id)),
    monitor: viewerProcedure
      .input(monitoringInput)
      .query(({ input }) => monitoringPage(input)),
    updateCommissioning: engineerProcedure
      .input(editCommissioningInput)
      .mutation(({ input, ctx }) => updateCommissioning(input, ctx.user.id)),
    list: viewerProcedure
      .input(
        z
          .object({
            status: deviceStatusEnum.optional(),
            type: deviceTypeEnum.optional(),
            zone: z.string().optional(),
          })
          .optional(),
      )
      .query(({ input }) => db.getDevices(input)),
    getById: viewerProcedure
      .input(z.object({ id: z.number() }))
      .query(({ input }) => db.getDeviceById(input.id)),
    getConnectedDevices: viewerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const gateway = await db.getDeviceById(input.id);
        if (!gateway || gateway.type !== "gateway") return [];
        const connected = await db.getDevicesForGateway(gateway.deviceId);
        const latest = await db.getLatestReadings(
          connected.map((child) => child.id),
        );
        const latestByDevice = new Map(
          latest.map((reading) => [reading.deviceId, reading]),
        );
        return connected.map((child) => ({
          ...child,
          latestReading: latestByDevice.get(child.id) ?? null,
        }));
      }),
    getConnectedAssets: viewerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const gateway = await db.getDeviceById(input.id);
        if (!gateway || gateway.type !== "gateway") return [];
        return db.getAssetsForGateway(gateway.deviceId);
      }),
    create: engineerProcedure
      .input(registerDeviceInput)
      .mutation(({ input, ctx }) => registerDevice(input, ctx.user.id)),
    update: engineerProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().optional(),
          status: deviceStatusEnum.optional(),
        }),
      )
      .mutation(({ input: { id, ...data } }) => db.updateDevice(id, data)),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        if (!(await db.deleteDevice(input.id)))
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Device not found",
          });
        return { deleted: true };
      }),
    getStats: viewerProcedure.query(() => db.getDeviceStats()),
    pulseIndicator: operatorProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const device = await db.getDeviceById(input.id);
        const gatewayDeviceId =
          typeof device?.metadata?.gatewayId === "string"
            ? device.metadata.gatewayId
            : undefined;
        if (
          !device ||
          device.isDemo ||
          !["edge_device", "sensor"].includes(device.type) ||
          !gatewayDeviceId
        ) {
          throw new Error(
            "A live gateway-connected WROVER edge device is required",
          );
        }
        const commandId = randomUUID();
        const userToken = await sdk.createSessionToken(ctx.user, {
          expiresInMs: 60_000,
          sessionId: ctx.session?.sessionId,
        });
        return publishWroverIndicator(
          {
            gatewayDeviceId,
            targetDeviceId: device.deviceId,
            commandId,
            expiresAt: Date.now() + 10_000,
          },
          userToken,
        );
      }),
  }),

  assets: router({
    list: viewerProcedure.query(() => db.getAssets()),
    getPassport: viewerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ input }) => passports.previewPassport(input.id)),
    getPublishedPassport: publicProcedure
      .input(z.object({ publicId: z.uuid() }))
      .query(({ input }) => passports.getPublishedPassport(input.publicId)),
    passportPublications: engineerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(({ input }) => passports.publications(input.id)),
    publishPassport: engineerProcedure
      .input(passports.publicationInput)
      .mutation(({ input, ctx }) =>
        passports.publishPassport(input, ctx.user.id),
      ),
    revokePassport: engineerProcedure
      .input(z.object({ publicId: z.uuid() }))
      .mutation(({ input }) => passports.revokePassport(input.publicId)),
    getById: viewerProcedure
      .input(z.object({ id: z.number() }))
      .query(({ input }) => db.getAssetById(input.id)),
    getAllForDevice: viewerProcedure
      .input(z.object({ devicePk: z.number().int().positive() }))
      .query(({ input }) => db.getAssetsForDevice(input.devicePk)),
    getForDevice: viewerProcedure
      .input(z.object({ devicePk: z.number() }))
      .query(({ input }) => db.getAssetForDevice(input.devicePk)),
    getShell: engineerProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const asset = await db.getAssetRecordById(input.id);
        if (!asset) return undefined;
        const demo = authoredDemoAas(asset);
        if (demo) return { ...demo, isDemo: true, missingRequiredFields: [] };
        const missingRequiredFields = asset.aasxImported
          ? []
          : requiredAasFields(asset);
        if (missingRequiredFields.length)
          return {
            shell: null,
            submodels: [],
            isDemo: asset.isDemo,
            missingRequiredFields,
          };
        return {
          shell: asset.aasShell,
          submodels: asset.aasSubmodels,
          conceptDescriptions: asset.aasConceptDescriptions,
          isDemo: asset.isDemo,
          missingRequiredFields: [],
        };
      }),
    exportAas: engineerProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const asset = await db.getAssetRecordById(input.id);
        if (!asset) return undefined;
        const demo = authoredDemoAas(asset);
        if (demo)
          return {
            assetAdministrationShells: [demo.shell],
            submodels: demo.submodels,
            conceptDescriptions: demo.conceptDescriptions,
          };
        if (!asset.aasxImported && requiredAasFields(asset).length) {
          throw new Error(
            "Complete the manufacturer identity and postal address fields before exporting this AAS",
          );
        }
        return {
          assetAdministrationShells: [asset.aasShell],
          submodels: asset.aasSubmodels,
          conceptDescriptions: asset.aasConceptDescriptions,
        };
      }),
    getLifecycle: engineerProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        if (!(await db.getAssetById(input.id))) return undefined;
        return db.getAssetLifecycleEvents(input.id);
      }),
    getVersions: engineerProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        if (!(await db.getAssetById(input.id))) return undefined;
        return db.getAssetVersions(input.id);
      }),
    getConnections: engineerProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        if (!(await db.getAssetById(input.id))) return undefined;
        return db.getAssetConnections(input.id);
      }),
    create: engineerProcedure
      .input(
        z
          .object({
            assetId: z.string().min(3).max(128),
            ...assetIdentityInput.shape,
            gatewayDevicePk: z.number().optional(),
            connectionMode: z
              .enum(["gateway", "direct_mqtt"])
              .default("gateway"),
            directDeviceId: z
              .string()
              .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/)
              .optional(),
            protocol: z
              .enum([
                "mqtt",
                "opcua",
                "modbus_tcp",
                "modbus_rtu",
                "serial",
                "ada031_v4_serial",
                "mqtt_direct",
              ])
              .default("mqtt"),
            endpoint: z
              .string()
              .max(512)
              .refine(
                (value) => !/:\/\/[^/]*@/.test(value),
                "Machine endpoints must not include credentials",
              )
              .optional(),
            tagMappings: edgeTagMappingsSchema.default([]),
          })
          .superRefine((input, context) => {
            if (
              input.connectionMode === "direct_mqtt" &&
              (!input.directDeviceId ||
                input.protocol !== "mqtt_direct" ||
                input.gatewayDevicePk)
            ) {
              context.addIssue({
                code: "custom",
                message:
                  "Direct MQTT requires its device ID and cannot also select a gateway",
                path: ["directDeviceId"],
              });
            }
            if (
              input.connectionMode === "gateway" &&
              input.protocol === "mqtt_direct"
            ) {
              context.addIssue({
                code: "custom",
                message:
                  "Select Direct MQTT for a device that connects without a gateway",
                path: ["connectionMode"],
              });
            }
          }),
      )
      .mutation(async ({ input, ctx }) => {
        const assetIdentity = {
          assetId: input.assetId,
          name: input.name,
          assetType: input.assetType,
          manufacturer: input.manufacturer,
          model: input.model,
          manufacturerStreet: input.manufacturerStreet,
          manufacturerZipcode: input.manufacturerZipcode,
          manufacturerCityTown: input.manufacturerCityTown,
          manufacturerNationalCode: input.manufacturerNationalCode,
          manufacturerArticleNumber: input.manufacturerArticleNumber,
          orderCodeOfManufacturer: input.orderCodeOfManufacturer,
          serialNumber: input.serialNumber,
          ratedValue: input.ratedValue,
          ratedUnit: input.ratedUnit,
        };
        const { documents: aas, remote } = await provisionAas(assetIdentity);
        try {
          const created = await db.createAsset(
            {
              assetId: input.assetId,
              name: input.name,
              assetType: input.assetType,
              manufacturer: input.manufacturer || null,
              model: input.model || null,
              manufacturerStreet: input.manufacturerStreet,
              manufacturerZipcode: input.manufacturerZipcode,
              manufacturerCityTown: input.manufacturerCityTown,
              manufacturerNationalCode: input.manufacturerNationalCode,
              manufacturerArticleNumber: input.manufacturerArticleNumber,
              orderCodeOfManufacturer: input.orderCodeOfManufacturer,
              ratedValue: input.ratedValue || null,
              ratedUnit: input.ratedUnit || null,
              serialNumber: input.serialNumber || null,
              location: input.location || null,
              zone: input.zone || null,
              lifecycleStage: "planned",
              isDemo: false,
              aasShell: aas.shell,
              aasSubmodels: aas.submodels,
            },
            input.connectionMode === "direct_mqtt"
              ? {
                  mode: "direct_mqtt" as const,
                  deviceId: input.directDeviceId!,
                }
              : input.gatewayDevicePk
                ? {
                    mode: "gateway" as const,
                    deviceId: input.gatewayDevicePk,
                    protocol: input.protocol,
                    endpoint: input.endpoint,
                    tagMappings: input.tagMappings,
                  }
                : undefined,
            ctx.user.id,
          );
          let edgeSync: "not_requested" | "published" | "pending" =
            "not_requested";
          if (input.gatewayDevicePk) {
            const gateway = await db.getDeviceById(input.gatewayDevicePk);
            if (gateway) {
              try {
                const published = await publishEdgeConfiguration({
                  schemaVersion: 1,
                  gatewayDeviceId: gateway.deviceId,
                  assets: await db.getGatewayAssetConnections(gateway.deviceId),
                });
                edgeSync = published.published ? "published" : "pending";
              } catch (syncError) {
                console.error(
                  "[Edge configuration] Publish failed; gateway can be updated from the AAS page:",
                  syncError instanceof Error
                    ? syncError.message
                    : "unknown error",
                );
                edgeSync = "pending";
              }
            }
          }
          return {
            id: created.id,
            assetId: created.assetId,
            provisioned: remote,
            edgeSync,
            connectionMode: input.connectionMode,
          };
        } catch (error) {
          if (remote) {
            try {
              await removeProvisionedAas(assetIdentity);
            } catch (cleanupError) {
              console.error(
                "[AAS provisioning] Compensating delete failed:",
                cleanupError instanceof Error
                  ? cleanupError.message
                  : "unknown error",
              );
            }
          }
          throw error;
        }
      }),
    update: engineerProcedure
      .input(
        z.object({
          id: z.number(),
          expectedVersion: z.number().int().positive(),
          changeNote: z.string().trim().min(3).max(1000),
          ...assetIdentityInput.shape,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const { id, expectedVersion, changeNote, ...identity } = input;
        const current = await db.getAssetRecordById(id);
        if (!current) throw new Error("Asset not found");
        if (current.isDemo) throw new Error("Demo assets are read-only");
        const updated = await updateAssetRevision(
          id,
          expectedVersion,
          identity,
          ctx.user.id,
          changeNote,
        );
        if (!updated) throw new Error("Asset not found");
        return updated;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ input }) => deleteAssetInventoryRecord(input.id)),
    restoreVersion: engineerProcedure
      .input(
        z.object({
          id: z.number(),
          sourceVersion: z.number().int().positive(),
          expectedVersion: z.number().int().positive(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = await db.getAssetRecordById(input.id);
        if (!current) throw new Error("Asset not found");
        if (current.isDemo || current.aasxImported)
          throw new Error(
            "This asset type cannot be restored through the form editor",
          );
        const historical = await db.getAssetVersionSnapshot(
          input.id,
          input.sourceVersion,
        );
        const snapshot = historical?.snapshot as
          | { asset?: Record<string, unknown> }
          | undefined;
        if (!snapshot?.asset)
          throw new Error("The requested asset version was not found");
        // Drizzle stores optional SQL strings as null; the edit contract treats
        // omitted optional fields as undefined, so drop nulls before validating.
        const restoredFields = Object.fromEntries(
          Object.entries(snapshot.asset).filter(([, value]) => value !== null),
        );
        const identity = assetIdentityInput.parse(restoredFields);
        const result = await updateAssetRevision(
          input.id,
          input.expectedVersion,
          identity,
          ctx.user.id,
          `Restored from version ${input.sourceVersion}`,
        );
        if (!result) throw new Error("Asset not found");
        return result;
      }),
    exportGatewayConfiguration: engineerProcedure
      .input(z.object({ gatewayDeviceId: z.string().min(1) }))
      .query(async ({ input }) => ({
        schemaVersion: 1,
        gatewayDeviceId: input.gatewayDeviceId,
        assets: await db.getGatewayAssetConnections(input.gatewayDeviceId),
      })),
    publishGatewayConfiguration: engineerProcedure
      .input(z.object({ gatewayDevicePk: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const gateway = await db.getDeviceById(input.gatewayDevicePk);
        if (!gateway || gateway.type !== "gateway" || gateway.isDemo)
          throw new Error("Select a registered live edge gateway");
        const result = await publishEdgeConfiguration({
          schemaVersion: 1,
          gatewayDeviceId: gateway.deviceId,
          assets: await db.getGatewayAssetConnections(gateway.deviceId),
        });
        return { ...result, gatewayDeviceId: gateway.deviceId };
      }),
    controlAda031: engineerProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          command: z.discriminatedUnion("action", [
            z.object({
              action: z.literal("jog"),
              joint: z.enum([
                "base",
                "shoulder",
                "elbow",
                "wrist_rotation",
                "gripper",
              ]),
              direction: z.enum(["increase", "decrease"]),
            }),
            z.object({
              action: z.literal("set_profile"),
              profile: z.enum(["pick_and_place_repeat", "demonstration_moves"]),
            }),
            z.object({ action: z.literal("neutral") }),
            z.object({ action: z.literal("stop_program") }),
          ]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const asset = await db.getAssetRecordById(input.id);
        if (!asset || asset.isDemo)
          throw new Error("A live registered ADA031 asset is required");
        const connection = (await db.getAssetConnections(input.id)).find(
          (candidate) => candidate.protocol === "ada031_v4_serial",
        );
        if (!connection)
          throw new Error(
            "This asset has no ADA031 V4 USB serial control profile",
          );
        const commandId = randomUUID();
        // Re-sign the current DB-backed role for one minute so DeviceService sees
        // fresh authorization even when an older browser cookie has a stale role.
        const userToken = await sdk.createSessionToken(ctx.user, {
          expiresInMs: 60_000,
          sessionId: ctx.session?.sessionId,
        });
        return publishAda031Control(
          {
            gatewayDeviceId: connection.gatewayDeviceId,
            assetId: asset.assetId,
            ...input.command,
            commandId,
            expiresAt: Date.now() + 10_000,
          },
          userToken,
        );
      }),
    transition: engineerProcedure
      .input(
        z.object({
          id: z.number(),
          toStage: assetLifecycleStageEnum,
          note: z.string().max(1000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const result = await db.transitionAssetLifecycle(
          input.id,
          input.toStage,
          ctx.user.id,
          input.note,
        );
        if (!result) throw new Error("Asset not found");
        return result;
      }),
  }),

  users: router({
    list: adminProcedure.query(() => db.listUsers()),
    pendingRequests: adminProcedure.query(() => pendingAccountRequests()),
    approveRegistration: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          role: z
            .enum(["viewer", "operator", "engineer", "admin"])
            .default("viewer"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const user = await approveRegistration(
          input.id,
          ctx.user.id,
          input.role,
        );
        await db
          .enqueueWelcomeEmail(user)
          .catch((error) =>
            console.error(
              "[Email] Could not queue account welcome message:",
              error instanceof Error ? error.message : "unknown error",
            ),
          );
        await nativeEvent(
          "config.changed",
          {
            configRevision: randomUUID(),
            changedKeys: ["users.approval", "users.role"],
          },
          `An administrator approved an account request with ${user.role} access.`,
        );
        return user;
      }),
    dismissRequest: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const result = await dismissAccountRequest(input.id, ctx.user.id);
        await nativeEvent(
          "config.changed",
          {
            configRevision: randomUUID(),
            changedKeys: ["users.requests"],
          },
          "An administrator dismissed an account request.",
        );
        return result;
      }),
    create: adminProcedure
      .input(
        z.object({
          email: z.string().trim().toLowerCase().email().max(320),
          name: z.string().trim().min(1).max(255),
          password: newPasswordInput,
          role: z
            .enum(["viewer", "operator", "engineer", "admin"])
            .default("viewer"),
        }),
      )
      .mutation(async ({ input }) => {
        if (isDemoAccount(input.email))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This address is reserved for the shared walkthrough.",
          });
        if (await db.getUserByEmail(input.email))
          throw new TRPCError({
            code: "CONFLICT",
            message: "This account already exists",
          });
        const user = await db.createUser({
          ...input,
          password: await sdk.hashPassword(input.password),
          openId: randomUUID(),
          passwordChangeRequired: true,
          temporaryCredentialExpiresAt: new Date(Date.now() + 30 * 60_000),
        });
        await db
          .enqueueWelcomeEmail(user)
          .catch((error) =>
            console.error(
              "[Email] Could not queue account welcome message:",
              error instanceof Error ? error.message : "unknown error",
            ),
          );
        return publicUser(user);
      }),
    setRole: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          role: z.enum(["viewer", "operator", "engineer", "admin"]),
          expectedVersion: z.number().int().nonnegative().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (input.id === ctx.user.id && input.role !== "admin")
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Ask another administrator to change your own administrator access.",
          });
        const result = await accountAction(() =>
          changeUserAccess(input.id, {
            role: input.role,
            expectedVersion: input.expectedVersion,
          }),
        );
        await wsManager.invalidateUser(input.id);
        if (!result) throw new Error("User not found");
        await nativeEvent(
          "config.changed",
          { configRevision: randomUUID(), changedKeys: ["users.roles"] },
          "An administrator changed an application role.",
        );
        return result;
      }),
    setEnabled: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          enabled: z.boolean(),
          expectedVersion: z.number().int().nonnegative(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (input.id === ctx.user.id && !input.enabled)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Ask another administrator to disable your account.",
          });
        const result = await accountAction(() =>
          changeUserAccess(input.id, {
            enabled: input.enabled,
            expectedVersion: input.expectedVersion,
          }),
        );
        await wsManager.invalidateUser(input.id);
        return result;
      }),
    revokeSessions: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          expectedVersion: z.number().int().nonnegative(),
        }),
      )
      .mutation(async ({ input }) => {
        const result = await accountAction(() =>
          changeUserAccess(input.id, {
            expectedVersion: input.expectedVersion,
          }),
        );
        await wsManager.invalidateUser(input.id);
        return result;
      }),
    resetPassword: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          temporaryPassword: newPasswordInput,
          expectedVersion: z.number().int().nonnegative(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (input.id === ctx.user.id)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Use your account's Change password action instead of resetting yourself.",
          });
        const passwordHash = await sdk.hashPassword(input.temporaryPassword);
        const result = await accountAction(() =>
          resetAccountCredential(input.id, passwordHash, input.expectedVersion),
        );
        await wsManager.invalidateUser(input.id);
        const user = await db.getUserById(input.id);
        if (user?.email)
          await completePasswordResetRequests(user.email, ctx.user.id);
        return result;
      }),
  }),

  readings: router({
    trend: viewerProcedure
      .input(
        telemetryRangeInput
          .safeExtend({
            deviceId: z.number().int().positive().optional(),
            assetIds: z.array(z.string().min(3).max(128)).max(1000).optional(),
            metric: metricEnum,
          })
          .refine(
            (v) => !!v.deviceId !== !!v.assetIds?.length,
            "Select a source or one or more assets",
          ),
      )
      .query(({ input }) => observationTrend(input)),
    getForDevice: viewerProcedure
      .input(
        telemetryRangeInput.safeExtend({
          deviceId: z.number().int().positive(),
          limit: z.number().int().min(1).max(10000).optional(),
        }),
      )
      .query(({ input }) =>
        db.getSensorReadings(
          input.deviceId,
          input.startTime,
          input.endTime,
          input.limit,
          input.scope,
        ),
      ),
    getLatest: viewerProcedure
      .input(
        z.object({ deviceId: z.number(), scope: evidenceScope.optional() }),
      )
      .query(({ input }) => db.getLatestReading(input.deviceId, input.scope)),
    getLatestBatch: viewerProcedure
      .input(
        z.object({
          deviceIds: z.array(z.number().int().positive()).max(500),
          scope: evidenceScope.optional(),
        }),
      )
      .query(({ input }) => db.getLatestReadings(input.deviceIds, input.scope)),
    create: operatorProcedure
      .input(
        z.object({
          deviceId: z.number(),
          temperature: z.number().optional(),
          timestamp: z.number(),
        }),
      )
      .mutation(() => {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Manual telemetry entry is retired. Use commissioned device ingestion, or a labelled isolated simulation.",
        });
      }),
  }),

  thresholds: router({
    getForDevice: engineerProcedure
      .input(z.object({ deviceId: z.number() }))
      .query(({ input }) => db.getAlertThresholds(input.deviceId)),
    upsert: engineerProcedure
      .input(thresholdInputSchema)
      .mutation(async ({ input }) => {
        const existing = await db.getAlertThresholds(input.deviceId);
        const match = existing.find((x) => x.metric === input.metric);
        if (match) {
          return db.updateAlertThreshold(match.id, {
            unit: input.unit,
            minValue: input.minValue ?? null,
            maxValue: input.maxValue ?? null,
            warningMin: input.warningMin ?? null,
            warningMax: input.warningMax ?? null,
            enabled: input.enabled ?? true,
          });
        }

        return db.createAlertThreshold({
          deviceId: input.deviceId,
          metric: input.metric,
          unit: input.unit,
          minValue: input.minValue ?? null,
          maxValue: input.maxValue ?? null,
          warningMin: input.warningMin ?? null,
          warningMax: input.warningMax ?? null,
          enabled: input.enabled ?? true,
        });
      }),
    upsertForDevice: engineerProcedure
      .input(
        z
          .object({
            deviceId: z.number(),
            thresholds: z.array(thresholdInputSchema),
          })
          .superRefine((input, context) => {
            if (
              input.thresholds.some(
                (threshold) => threshold.deviceId !== input.deviceId,
              )
            ) {
              context.addIssue({
                code: "custom",
                message: "All thresholds must belong to the selected device",
              });
            }
            if (
              new Set(input.thresholds.map((threshold) => threshold.metric))
                .size !== input.thresholds.length
            ) {
              context.addIssue({
                code: "custom",
                message: "Configure each metric only once",
              });
            }
          }),
      )
      .mutation(async ({ input }) => {
        await db.upsertAlertThresholds(
          input.deviceId,
          input.thresholds.map((t) => ({
            deviceId: t.deviceId,
            metric: t.metric,
            unit: t.unit,
            minValue: t.minValue ?? null,
            maxValue: t.maxValue ?? null,
            warningMin: t.warningMin ?? null,
            warningMax: t.warningMax ?? null,
            enabled: t.enabled ?? true,
          })),
        );

        return db.getAlertThresholds(input.deviceId);
      }),
  }),

  alerts: router({
    history: viewerProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          after: z.number().int().nonnegative().default(0),
        }),
      )
      .query(({ input }) => incidentHistory(input.id, input.after)),
    addNote: operatorProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          text: z
            .string()
            .trim()
            .min(1)
            .max(2000)
            .refine(
              (t) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t),
              "Remove control characters",
            ),
        }),
      )
      .mutation(({ input, ctx }) =>
        addIncidentNote(input.id, input.text, ctx.user.id),
      ),
    page: viewerProcedure
      .input(
        z.object({
          page: z.number().int().min(0).max(100000).default(0),
          pageSize: z.number().int().min(1).max(100).default(25),
          search: z.string().trim().max(100).optional(),
          deviceId: z.number().int().positive().optional(),
          status: z.enum(["active", "acknowledged", "resolved"]).optional(),
          openOnly: z.boolean().optional(),
          severity: alertSeverityEnum.optional(),
          startTime: z.number().int().nonnegative().optional(),
          endTime: z.number().int().positive().optional(),
          assignedToId: z.number().int().positive().optional(),
        }),
      )
      .query(({ input: { page, pageSize, ...filters } }) =>
        db.getAlertPage(filters, page, pageSize),
      ),
    list: viewerProcedure
      .input(
        z
          .object({
            deviceId: z.number().int().positive().optional(),
            status: z.enum(["active", "acknowledged", "resolved"]).optional(),
            openOnly: z.boolean().optional(),
            severity: alertSeverityEnum.optional(),
            limit: z.number().int().min(1).max(1000).optional(),
            startTime: z.number().int().positive().optional(),
            endTime: z.number().int().positive().optional(),
          })
          .optional(),
      )
      .query(({ input }) => db.getAlerts(input)),
    getById: viewerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const alert = await db.getAlertById(input.id);
        if (!alert)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Event not found",
          });
        return alert;
      }),
    /** Legacy acknowledge route; a caller cannot select the acknowledging user's identity. */
    update: operatorProcedure
      .input(z.object({ id: z.number(), status: z.literal("acknowledged") }))
      .mutation(({ input, ctx }) =>
        runIncidentMutation(() => db.acknowledgeAlert(input.id, ctx.user.id)),
      ),
    updateStatus: operatorProcedure
      .input(z.object({ id: z.number(), status: z.literal("acknowledged") }))
      .mutation(({ input, ctx }) =>
        runIncidentMutation(() => db.acknowledgeAlert(input.id, ctx.user.id)),
      ),
    assignees: engineerProcedure.query(() => db.getAlertAssignees()),
    assign: engineerProcedure
      .input(
        z.object({
          id: z.number(),
          assignedToId: z.number().int().positive().nullable(),
        }),
      )
      .mutation(({ input, ctx }) =>
        runIncidentMutation(() =>
          db.assignAlert(input.id, input.assignedToId, ctx.user.id),
        ),
      ),
    startDowntime: engineerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input, ctx }) =>
        runIncidentMutation(() =>
          db.startAlertDowntime(
            input.id,
            ctx.user.id,
            ctx.user.role === "admin",
          ),
        ),
      ),
    resolve: engineerProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input, ctx }) =>
        runIncidentMutation(() =>
          db.resolveAlert(input.id, ctx.user.id, ctx.user.role === "admin"),
        ),
      ),
    getStats: viewerProcedure.query(() => db.getAlertStats()),
  }),

  firmware: router({
    list: engineerProcedure
      .input(z.object({ deviceType: deviceTypeEnum.optional() }).optional())
      .query(async ({ input }) =>
        (await db.getFirmwareVersions(input?.deviceType)).map(
          ({ fileUrl, ...firmware }) => ({
            ...firmware,
            artifactAvailable: Boolean(fileUrl && firmware.checksum),
          }),
        ),
      ),
  }),

  ota: router({
    capability: engineerProcedure.query(() => ({
      enabled: false,
      reason: otaUnavailableMessage,
    })),
    deploy: engineerProcedure
      .input(z.object({ deviceId: z.number(), firmwareVersionId: z.number() }))
      .mutation(() => {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: otaUnavailableMessage,
        });
      }),
    list: engineerProcedure
      .input(
        z
          .object({
            deviceId: z.number().int().positive().optional(),
            limit: z.number().int().min(1).max(1000).optional(),
          })
          .optional(),
      )
      .query(({ input }) => db.getOtaDeployments(input)),
    rollback: engineerProcedure
      .input(z.object({ deploymentId: z.number() }))
      .mutation(() => {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: otaUnavailableMessage,
        });
      }),
  }),

  analytics: router({
    getCoverage: viewerProcedure
      .input(assetTelemetryInput)
      .query(async ({ input, ctx }) => {
        if (!bundleEnabled() || demoOnlyRead())
          return { configured: false, assets: [] as AssetCoverage[] };
        const chunks = Array.from(
          { length: Math.ceil(input.assetIds.length / 200) },
          (_, index) => input.assetIds.slice(index * 200, (index + 1) * 200),
        );
        const assets = (
          await Promise.all(
            chunks.map((assetIds) =>
              internalService<AssetCoverage[]>(
                3105,
                "/api/analytics/coverage",
                ctx.user.id,
                { ...input, assetIds },
                ctx.session,
              ),
            ),
          )
        ).flat();
        return { configured: true, assets };
      }),
    getOverview: viewerProcedure.query(async () => ({
      devices: await db.getDeviceStats(),
      alerts: await db.getAlertStats(),
    })),
    getEnergy: viewerProcedure
      .input(telemetryRangeInput)
      .query(async ({ input }) => {
        const devices = await db.getDevices();
        return db.getAggregatedReadings(
          devices.map((d) => d.id),
          input.startTime,
          input.endTime,
          input.intervalMs,
          input.scope,
        );
      }),
    getEnergyConsumption: viewerProcedure
      .input(telemetryRangeInput)
      .query(async ({ input }) => {
        const devices = await db.getDevices();
        return db.getAggregatedReadings(
          devices.map((d) => d.id),
          input.startTime,
          input.endTime,
          input.intervalMs,
          input.scope,
        );
      }),
    getAssetTelemetry: viewerProcedure
      .input(assetTelemetryInput)
      .query(({ input }) =>
        db.getAssetTelemetry(
          input.assetIds,
          input.startTime,
          input.endTime,
          input.intervalMs,
          input.scope,
        ),
      ),
    getLatestAssetTelemetry: viewerProcedure
      .input(z.object({ assetId: z.string().min(3).max(128) }))
      .query(
        async ({ input }) =>
          (await db.getLatestAssetReadings([input.assetId]))[0] ?? null,
      ),
  }),

  export: router({
    deviceReport: viewerProcedure
      .input(
        telemetryRangeInput.safeExtend({
          deviceId: z.number().int().positive(),
        }),
      )
      .mutation(async ({ input }) => {
        const device = await db.getDeviceById(input.deviceId);
        if (!device) throw new Error("Device not found");
        const [summary, thresholds, incidents] = await Promise.all([
          deviceReadingSummary(
            input.deviceId,
            input.startTime,
            input.endTime,
            input.scope,
          ),
          db.getAlertThresholds(input.deviceId),
          db.getAlertPage(
            {
              deviceId: input.deviceId,
              startTime: input.startTime,
              endTime: input.endTime,
            },
            0,
            100,
          ),
        ]);
        const metadata = {
          scope: summary.scope,
          statisticsComplete: true,
          totalReadings: summary.total,
          totalIncidents: incidents.total,
          returnedIncidents: incidents.returned,
          hasMoreIncidents: incidents.hasMore,
          incidentDetailLimit: 100,
          truncated: incidents.hasMore,
        };
        return {
          html: pdf.generateDeviceReportHtml({
            device,
            readings: [],
            summary,
            metadata,
            thresholds,
            alerts: incidents.items,
            dateRange: {
              start: new Date(input.startTime),
              end: new Date(input.endTime),
            },
          }),
          filename: `device-report-${device.deviceId}.html`,
          metadata,
        };
      }),
    analyticsReport: viewerProcedure
      .input(assetTelemetryInput)
      .mutation(async ({ input }) => {
        const analytics = await db.getAssetTelemetry(
          input.assetIds,
          input.startTime,
          input.endTime,
          input.intervalMs,
          input.scope,
        );
        return {
          html: pdf.generateAssetAnalyticsReportHtml({
            metadata: analytics.metadata,
            assetCount: analytics.assets.length,
            sampleCount: analytics.overall.sampleCount,
            avgPower: analytics.overall.avgPower,
            avgTemperature: analytics.overall.avgTemperature,
            avgVibration: analytics.overall.avgVibration,
            assets: analytics.assets.map(
              ({ name, assetType, zone, sampleCount }) => ({
                name,
                assetType,
                zone,
                sampleCount,
              }),
            ),
            timeline: analytics.timeline,
            dateRange: {
              start: new Date(input.startTime),
              end: new Date(input.endTime),
            },
          }),
          filename: `analytics-report-${Date.now()}.html`,
          metadata: analytics.metadata,
        };
      }),
    alertHistoryReport: viewerProcedure
      .input(
        z
          .object({
            startTime: z.number().int().nonnegative(),
            endTime: z.number().int().positive(),
            severity: alertSeverityEnum.optional(),
            status: z.enum(["active", "acknowledged", "resolved"]).optional(),
            openOnly: z.boolean().optional(),
            search: z.string().trim().max(100).optional(),
          })
          .refine((v) => v.endTime > v.startTime, "End must follow start"),
      )
      .mutation(async ({ input }) => {
        const result = await db.getAlertPage(input, 0, 1000);
        const metadata = {
          total: result.total,
          returned: result.returned,
          hasMore: result.hasMore,
          truncated: result.hasMore,
          scope: result.scope,
          statisticsComplete: true,
          detailLimit: 1000,
        };
        return {
          html: pdf.generateAlertHistoryReportHtml({
            alerts: result.items.map((a) => ({
              ...a,
              deviceName: a.deviceName ?? "Observation source",
            })),
            summary: result.summary,
            dateRange: {
              start: new Date(input.startTime),
              end: new Date(input.endTime),
            },
            metadata,
          }),
          filename: `alert-history-report-${Date.now()}.html`,
          metadata,
        };
      }),
  }),

  notifications: router({
    page: viewerProcedure
      .input(
        z.object({
          search: z.string().trim().max(100).default(""),
          view: z
            .enum(["all", "unread", "delivery_attention", "accepted"])
            .default("all"),
          page: z.number().int().min(0).max(100000).default(0),
        }),
      )
      .query(({ input, ctx }) => notificationPage(ctx.user.id, input)),
    summary: viewerProcedure.query(({ ctx }) =>
      notificationSummary(ctx.user.id),
    ),
    list: viewerProcedure.query(({ ctx }) => listNotifications(ctx.user.id)),
    markRead: viewerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const row = await readNotification(ctx.user.id, input.id);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Notification not found",
          });
        return row;
      }),
    retryEmail: engineerProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        const row = await retryNotification(ctx.user.id, input.id);
        if (!row)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Notification is not eligible for retry",
          });
        return row;
      }),
    getConfigs: adminProcedure.query(() => notificationConfiguration()),
    updateConfig: adminProcedure
      .input(
        z.object({
          configId: z.string(),
          enabled: z.boolean().optional(),
          recipient: z.string().optional(),
        }),
      )
      .mutation(() => {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Configure Graph sender and recipient domains in the deployment environment. Incident recipients come from authorized dashboard accounts.",
        });
      }),
  }),

  assistant: router({
    providers: viewerProcedure.query(() =>
      assistantProviderCatalog(!demoOnlyRead()),
    ),
    context: viewerProcedure
      .input(z.object({ assetId: z.string().trim().min(3).max(128) }))
      .query(async ({ input }) =>
        (await import("./assistantPresentation")).assistantAssetContext(
          input.assetId,
        ),
      ),
    ask: assistantAskProcedure,
    // An additive route prevents older APIs from silently ignoring a selected model.
    askSelected: assistantAskProcedure,
  }),
});

export type AppRouter = typeof appRouter;
