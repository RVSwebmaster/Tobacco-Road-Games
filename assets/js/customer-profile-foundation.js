(() => {
  const CABINET_MARKUP = `
    <div class="shop-wall-fixed-cabinet" data-fixed-cabinet>
      <section class="shop-wall-row shop-wall-row--identity" aria-label="Tobacco Road Games customer profile foundation">
        <picture class="shop-wall-cabinet-art" aria-hidden="true">
          <source media="(max-width: 699px)" srcset="/assets/images/storefront-shelf-dressing/upper-cabinet-mobile.png?v=20261004-frozen1">
          <source media="(max-width: 1023px)" srcset="/assets/images/storefront-shelf-dressing/upper-cabinet-tablet.png?v=20261004-frozen1">
          <img src="/assets/images/storefront-shelf-dressing/upper-cabinet-desktop.png?v=20261004-frozen1" alt="" width="2904" height="1179" fetchpriority="high" decoding="async" draggable="false">
        </picture>

        <section class="shop-wall-bay shop-wall-bay--library" aria-labelledby="your-library-heading">
          <div class="shop-wall-plaque"><h2 id="your-library-heading">YOUR LIBRARY</h2></div>
          <div class="shop-wall-shelves shop-wall-shelves--library" aria-label="Left profile shelves">
            <div class="shop-wall-shelf-level shop-wall-shelf-level--upper" data-profile-shelf="upper-left">
              <div class="shop-wall-product-row shop-wall-product-row--library shop-wall-product-row--right">
                <div class="shop-wall-library-books" data-fill-profile-shelf>
                  <figure class="shop-wall-product-mock shop-wall-product-mock--spine" aria-hidden="true"></figure>
                </div>
              </div>
            </div>
            <div class="shop-wall-shelf-level shop-wall-shelf-level--lower" data-profile-shelf="lower-left">
              <div class="shop-wall-product-row shop-wall-product-row--library shop-wall-product-row--right">
                <div class="shop-wall-library-books" data-fill-profile-shelf>
                  <figure class="shop-wall-product-mock shop-wall-product-mock--spine" aria-hidden="true"></figure>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="shop-wall-bay shop-wall-bay--identity" aria-labelledby="customer-profile-foundation-heading">
          <div class="shop-wall-identity-space">
            <h1 id="customer-profile-foundation-heading"><span>Tobacco Road</span><span>Games</span></h1>
          </div>
          <div class="shop-wall-identity-sign" aria-hidden="true">
            <img src="/assets/images/storefront-shelf-dressing/golden-d20-lantern-logo.png?v=20261003-golden-d20-1" alt="" loading="eager" decoding="async">
            <p class="shop-wall-identity-title"><span>Tobacco Road</span><span>Games</span></p>
          </div>
        </section>

        <section class="shop-wall-bay shop-wall-bay--products" aria-labelledby="open-rules-library-heading">
          <h2 class="shop-wall-heading-hidden" id="open-rules-library-heading">OPEN RULES LIBRARY</h2>
          <div class="shop-wall-shelves" aria-label="Right profile shelves">
            <div class="shop-wall-shelf-level shop-wall-shelf-level--upper" data-profile-shelf="upper-right">
              <div class="shop-wall-product-row shop-wall-product-row--library">
                <div class="shop-wall-library-books" data-fill-profile-shelf>
                  <figure class="shop-wall-product-mock shop-wall-product-mock--spine" aria-hidden="true"></figure>
                </div>
              </div>
            </div>
            <div class="shop-wall-shelf-level shop-wall-shelf-level--lower" data-profile-shelf="lower-right">
              <div class="shop-wall-product-row shop-wall-product-row--library">
                <div class="shop-wall-library-books" data-fill-profile-shelf>
                  <figure class="shop-wall-product-mock shop-wall-product-mock--spine" aria-hidden="true"></figure>
                </div>
              </div>
            </div>
          </div>
        </section>
        <span class="shop-wall-shelf-fixtures" aria-hidden="true"><span></span><span></span><span></span></span>
      </section>
    </div>`;

  function fillDecorativeBooks(books, count) {
    const reference = books.firstElementChild;
    if (!reference || !Number.isInteger(count) || count < 1) return;
    while (books.children.length < count) {
      const book = reference.cloneNode(true);
      book.setAttribute("aria-hidden", "true");
      books.appendChild(book);
    }
    while (books.children.length > count) books.lastElementChild.remove();
  }

  function prepareCabinet(cabinet) {
    const stage = cabinet.querySelector(".shop-wall-row--identity");
    const artwork = cabinet.querySelector(".shop-wall-cabinet-art");
    const artworkImage = artwork.querySelector("img");
    const resizeCabinet = () => {
      const width = Number.parseFloat(getComputedStyle(stage).width);
      if (Number.isFinite(width) && width > 0) {
        artwork.style.width = `${width}px`;
        artworkImage.style.width = `${width}px`;
        cabinet.style.setProperty("--cabinet-scale", String(cabinet.getBoundingClientRect().width / width));
      }
    };

    cabinet.querySelectorAll("[data-fill-profile-shelf]").forEach((books) => {
      const row = books.parentElement;
      const resizeBooks = () => {
        const stopSide = row.classList.contains("shop-wall-product-row--right") ? "::before" : "::after";
        const spineWidth = Number.parseFloat(getComputedStyle(row, stopSide).width);
        if (!Number.isFinite(spineWidth) || spineWidth <= 0) return;
        const clearance = spineWidth * 6;
        row.style.setProperty("--library-bookstop-clearance", `${clearance}px`);
        const availableWidth = row.clientWidth - clearance;
        fillDecorativeBooks(books, Math.max(1, Math.floor(availableWidth / spineWidth)));
      };
      resizeBooks();
      new ResizeObserver(resizeBooks).observe(row);
    });

    resizeCabinet();
    new ResizeObserver(resizeCabinet).observe(cabinet);
  }

  function mount(root) {
    if (!(root instanceof Element)) return;
    root.innerHTML = CABINET_MARKUP;
    prepareCabinet(root.querySelector("[data-fixed-cabinet]"));
  }

  window.TRGCustomerProfileFoundation = Object.freeze({ mount });
  document.querySelectorAll("[data-customer-profile-foundation]").forEach(mount);
})();
