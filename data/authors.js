const AUTHORS = [
  {
    slug: "rv-sawyer",
    displayName: "RV Sawyer",
    profileImage: "",
    logo: "",
    bannerImage: "",
    title: "Game Master, writer, and founder of Tobacco Road Games",
    shortBio:
      "RV Sawyer is the founder of Tobacco Road Games, shaped by 46 years behind the screen across fantasy, science fiction, horror, superheroes, pulp, westerns, survival play, and stranger roads besides.",
    longBio:
      "RV Sawyer writes tabletop tools, adventures, essays, and game material from the working side of the GM screen. Tobacco Road Games grew out of decades of actual table play: campaigns that survived, systems that taught hard lessons, monsters that became memories, and rules tested against real players doing beautifully unreasonable things.",
    profileTemplate: "bookshelf",
    accent: "",
    marketplaceStatus: "active",
    joinDate: "2026-05-27",
    links: [],
    blogPosts: [
      {
        slug: "from-the-working-side-of-the-screen",
        title: "From the Working Side of the Screen",
        date: "2026-06-14",
        excerpt:
          "A short note on what Tobacco Road Games is building: practical tools, strange roads, and table-tested material for games that need more than another pile of modifiers.",
        body: [
          "Tobacco Road Games is being built from the working side of the screen, where a rule only matters if it survives players, pressure, pacing, and the kind of decision nobody thought anyone would actually make.",
          "That means practical tools, strange roads, and table-tested material: adventures with weather, monsters with motives, and game pieces meant to be used at a living table instead of admired from a safe distance."
        ]
      }
    ]
  }
];

if (typeof module !== "undefined") {
  module.exports = AUTHORS;
}

if (typeof window !== "undefined") {
  window.TRG_AUTHORS = AUTHORS;
}
