function createOwnerWorkbenchFixture({
  ownerId = "owner-open-workbench",
  origin = "https://example.com"
} = {}) {
  return {
    environment: {},
    mode: "open_workbench",
    options: {},
    ownerId,
    readRequest(route) {
      return new Request(new URL(route, origin));
    },
    jsonRequest(route, body) {
      return new Request(new URL(route, origin), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
    }
  };
}

module.exports = { createOwnerWorkbenchFixture };
