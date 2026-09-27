# AVA customer profile-first lookup

## Goal
When a broker asks AVA to find, show, or fetch a customer, AVA must locate the customer in Maestro and display the verified profile before suggesting any call or email.

## Changes
- Detect customer lookup requests separately from explicit call, SMS, and email requests.
- Resolve the customer through the broker’s Maestro client list using name, email, phone, or Maestro identifier.
- When one customer matches, fetch and render the full verified profile and available mortgage files immediately.
- When several customers match, show the matching profiles for selection; when none match, report that clearly.
- Do not include call or email actions unless the user explicitly asks for them in that message.
- Deploy the corrected AVA chat function and validate its response behavior without placing calls or sending messages.

## Technical details
- Keep Maestro reads broker-scoped and authenticated.
- Preserve existing confirmation requirements for communication actions.
- Do not modify mobile-native code, telephony configuration, secrets, OAuth, scheduled tasks, DIDs, or SIP devices.
