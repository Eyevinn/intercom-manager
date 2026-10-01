// A structurally valid dummy JWT (header.payload.signature). The reauth/share
// handlers now reject malformed tokens up front (#226), so this fixture must
// look like a real JWT to exercise the happy path.
process.env.OSC_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.dummy-signature';
