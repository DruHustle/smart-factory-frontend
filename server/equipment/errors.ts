import { TRPCError } from "@trpc/server";
/** Expose expected operator conflicts without exposing database queries or secrets. */
export async function operatorAction<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (
      /^(Registration revision conflict|Mapping revision conflict|Workspace revision conflict|Equipment revision conflict|Model revision conflict|Immutable source identity conflict|Component hierarchy is immutable|External identifier already registered|Target equipment already belongs|Every source component needs|Ambiguous |Unknown or ambiguous|Unsupported |Select a registered|Explicit compatible|Model change must|Public demonstration|Demonstration |Only an individually|Equipment not found|Register source equipment first|Integration is disabled|Persisted integration scope differs)/.test(
        message,
      )
    )
      throw new TRPCError({
        code: /revision conflict/.test(message)
          ? "CONFLICT"
          : /not found/.test(message)
            ? "NOT_FOUND"
            : /Persisted integration/.test(message)
              ? "PRECONDITION_FAILED"
              : "BAD_REQUEST",
        message,
      });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The operation could not be completed",
    });
  }
}
