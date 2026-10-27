import { describe, expect, it } from "vitest";
import { validatedMobileCredentialIdentity } from "../mobileCredentialIdentity";

const credentials = (extension: string) => ({ client_type: "mobile", sip_extension: extension, device_id: `${extension}M`, sip_username: `${extension}M`, sip_auth_user: `${extension}M` });
describe("strict mobile registration identity", () => {
  it.each(["1117", "1142", "113", "1999"])("requires all mobile credentials to be %sM", (extension) => {
    expect(validatedMobileCredentialIdentity(credentials(extension))).toEqual({ extension, username: `${extension}M` });
  });
  it.each(["1117x", "1117W", "1117_mobile", "1142M", "1117xM", "1117"])("rejects %s without changing its suffix", (sip_username) => {
    expect(validatedMobileCredentialIdentity({ ...credentials("1117"), sip_username })).toBeNull();
  });
  it("rejects widget client type even with M-shaped fields", () => {
    expect(validatedMobileCredentialIdentity({ ...credentials("1117"), client_type: "widget" })).toBeNull();
  });
  it.each(["device_id", "sip_auth_user"])("rejects mismatched %s", (field) => {
    expect(validatedMobileCredentialIdentity({ ...credentials("1117"), [field]: "1117x" })).toBeNull();
  });
});