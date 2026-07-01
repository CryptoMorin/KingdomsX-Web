import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";

const gallery = document.querySelector("[data-gallery]");
const root = document.documentElement;

if (gallery) {
  const galleryItems = [...gallery.querySelectorAll("a")];
  const pauseViewerVideos = () => {
    document.querySelectorAll(".pswp video[data-gallery-viewer-video]").forEach((video) => {
      video.pause();
    });
  };
  const playCurrentViewerVideo = (pswp) => {
    pauseViewerVideos();

    const currentVideo = pswp.currSlide?.content?.element?.querySelector("video[data-gallery-viewer-video]");

    if (currentVideo) {
      currentVideo.play().catch(() => {});
    }
  };
  const lightbox = new PhotoSwipeLightbox({
    gallery,
    children: "a",
    bgOpacity: 0.95,
    imageClickAction: "zoom",
    tapAction: "toggle-controls",
    bgClickAction: "close",
    pswpModule: () => import("photoswipe")
  });

  lightbox.addFilter("domItemData", (itemData, element, linkEl) => {
    if (linkEl?.dataset.galleryMediaType !== "video") {
      return itemData;
    }

    const videoSrc = linkEl.dataset.galleryVideoSrc || itemData.src;
    const videoWrapper = document.createElement("div");
    const video = document.createElement("video");

    videoWrapper.className = "gallery-viewer-video-wrap";
    video.className = "gallery-viewer-video";
    video.src = videoSrc;
    video.setAttribute("aria-label", linkEl.dataset.pswpTitle || "");
    video.controls = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.dataset.galleryViewerVideo = "";
    videoWrapper.append(video);

    return {
      ...itemData,
      src: undefined,
      type: "html",
      html: videoWrapper.outerHTML
    };
  });

  lightbox.on("beforeOpen", () => {
    root.style.setProperty("--gallery-scrollbar-width", `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
    root.classList.add("gallery-viewer-scroll-lock");
  });

  lightbox.on("destroy", () => {
    pauseViewerVideos();
    root.classList.remove("gallery-viewer-scroll-lock");
    root.style.removeProperty("--gallery-scrollbar-width");
  });

  lightbox.on("uiRegister", () => {
    lightbox.pswp.ui.registerElement({
      name: "gallery-title",
      className: "gallery-viewer-title position-absolute start-50 translate-middle-x text-center",
      order: 9,
      isButton: false,
      appendTo: "root",
      html: '<p class="gallery-viewer-title-text"></p>',
      onInit: (element, pswp) => {
        const title = element.querySelector(".gallery-viewer-title-text");

        pswp.on("change", () => {
          const dataset = pswp.currSlide?.data?.element?.dataset || {};

          title.textContent = dataset.pswpTitle || "";
        });
      }
    });

    lightbox.pswp.ui.registerElement({
      name: "gallery-thumbs",
      className: "gallery-viewer-thumbs position-absolute bottom-0 start-50 translate-middle-x d-flex justify-content-start mb-3",
      order: 10,
      isButton: false,
      appendTo: "root",
      html: "",
      onInit: (element, pswp) => {
        let isReady = false;
        let pendingIndex = null;

        const showItem = (index) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              pswp.goTo(index);
            });
          });
        };

        element.setAttribute("aria-label", "Gallery image selector");
        ["click", "mousedown", "pointerdown", "touchstart"].forEach((eventName) => {
          element.addEventListener(eventName, (event) => {
            event.stopPropagation();
          });
        });
        element.addEventListener(
          "wheel",
          (event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            element.scrollLeft += event.deltaY;
          },
          { passive: false }
        );

        galleryItems.forEach((item, index) => {
          const button = document.createElement("button");
          const thumbnail = item.querySelector("img, video")?.cloneNode();

          button.className = "gallery-viewer-thumb flex-shrink-0 p-0 overflow-hidden";
          button.type = "button";
          button.setAttribute("aria-label", `Show gallery item ${index + 1}`);

          if (thumbnail) {
            thumbnail.classList.add("w-100", "h-100", "object-fit-cover");

            if (thumbnail.tagName === "IMG") {
              thumbnail.alt = "";
              thumbnail.loading = "lazy";
              thumbnail.decoding = "async";
            } else if (thumbnail.tagName === "VIDEO") {
              thumbnail.removeAttribute("aria-label");
              thumbnail.muted = true;
              thumbnail.loop = true;
              thumbnail.autoplay = true;
              thumbnail.playsInline = true;
              thumbnail.preload = "metadata";
            }

            button.append(thumbnail);
          }

          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (!isReady) {
              pendingIndex = index;
              return;
            }

            showItem(index);
          });

          element.append(button);
        });

        const thumbs = [...element.querySelectorAll(".gallery-viewer-thumb")];

        pswp.on("change", () => {
          thumbs.forEach((thumb, thumbIndex) => {
            const isActive = thumbIndex === pswp.currIndex;

            thumb.classList.toggle("is-active", isActive);
            thumb.setAttribute("aria-current", isActive ? "true" : "false");

            if (isActive) {
              thumb.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
          });

          playCurrentViewerVideo(pswp);
        });

        pswp.on("openingAnimationEnd", () => {
          isReady = true;
          playCurrentViewerVideo(pswp);

          if (pendingIndex !== null) {
            showItem(pendingIndex);
            pendingIndex = null;
          }
        });
      }
    });
  });

  lightbox.init();

  document.querySelector("[data-gallery-open-all]")?.addEventListener("click", () => {
    lightbox.loadAndOpen(0);
  });
}
