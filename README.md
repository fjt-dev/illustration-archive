# Illustration Archive

> A browser extension that records liked (bookmarked) artworks in a local folder

Illustration Archive records artwork images and metadata in a folder you choose. It does not use a proprietary external server.

## Features

- Records artwork information centered around `metadata.json`
- Optionally records artwork images
- Supports any folder or external storage device
- Manually records artworks
- Searches by title, artist, and tag
- Sorts by archive date, post date, title, artist name, or size
- Filters by multiple tags at once
- Filters favorite artworks
- Provides an image viewer that switches between a right-side dock and full-screen display
- Browses continuously across artworks with the arrow keys
- Helps find source images using archived image URLs and filenames
- Selects multiple artworks and deletes them from the list in bulk
- Supports light and dark modes

## Requirements

- A Chromium-based browser such as Google Chrome
- Support for Manifest V3 and the File System Access API
- A signed-in pixiv account

Firefox is not currently supported.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose this repository's folder.

## Usage

1. Select **Open archive** from the extension popup.
2. Review and accept the usage notice shown on first launch.
3. If you want to include images or keep metadata as files, choose a folder under **Archive folder**.
4. Open the popup on an artwork page and select **Record this artwork**.
5. Select **Open archive** to browse your recorded artworks.

> [!TIP]
> Bookmark the archive page in your browser for quick access. You can reopen the instructions at any time from **Guide** in the bottom-right corner.

### Browsing the archive

- **Single-click** a thumbnail to open the image viewer at full width without selecting the artwork.
- You can also **double-click** a thumbnail to open the viewer.
- The **⋯** menu on each card lets you view metadata, open the source page, search with Google, or delete the artwork from the archive.
- Use the sort menu next to the search box to sort by archive date, post date, title, artist name, or size.
- The tag filters scroll horizontally, while the Favorites filter stays pinned to the left. If you select multiple tags, use **Reset tags** to clear them all at once.

### Hide-titles mode

- Select the four-square icon (**Hide titles**) at the top of the archive to switch to an image-focused square tile layout. Select the card icon with lines below the image (**Standard view**) to switch back. Hover over either icon to see its name.
- Scrolling automatically loads 36 more artworks at a time. You can also select **Load more**.
- Search, tags, favorites, and sorting remain active. Loading stops after all matching archived artworks are displayed, without repeating any artwork.
- Select a tile to open the viewer at the image's original aspect ratio. The heart button is hidden in tile view, so change favorites in standard view. Selection and artwork menus are available in both modes.
- Selection checkboxes appear on hover or keyboard focus and remain visible for selected artworks. They are always visible on touch devices.
- The display mode is remembered for your next visit. **Select all** applies to the complete filtered result, including items that have not yet loaded.

### Image viewer

- The viewer displays the artwork image prominently in the center. Use the buttons at the bottom right to move between pages and artworks.
- The bottom left shows the artwork title, artist, artwork ID, and a link to the source artwork page.
- Select **Close** at the top right or press Esc to return to the archive.
- Use `←` / `→` to move between pages. At the first or last page of an artwork, navigation continues automatically to the previous or next artwork in the archive. The same behavior applies to single-page artworks.

### Recording images

By default, only metadata is added to the browser's archive and artwork images are not downloaded. In this mode, you can use the extension without selecting an archive folder. To include images, choose an archive folder, enable **Include images**, and accept the notice that appears.

Metadata-only records retain the original image URLs and filenames available when the artwork was recorded. Under **Find the original image**, you can use search links based on the artwork ID, title, artist, filename, and source URL. The extension does not directly retrieve or save images in this mode, and it cannot guarantee that an image will remain available if the source is deleted.

## Recorded data

The extension creates a folder like the following for each artwork. Image files are recorded only when **Include images** is enabled.

```text
Selected archive folder/
└── ArtworkID_Title/
    ├── metadata.json
    ├── p0.jpg
    └── p1.jpg
```

Image extensions and counts vary by artwork. The browser stores the metadata needed to display the archive and the archive-folder setting.

Recording the same artwork again replaces files with the same names. Deleting an artwork from the archive does not delete its image files from the archive folder.

## Keyboard shortcuts

| Key                    | Action                                           |
| ---------------------- | ------------------------------------------------ |
| `/`                    | Focus the search box                             |
| `Cmd + A` / `Ctrl + A` | Select all visible artworks                      |
| `Esc`                  | Clear selection or close an open menu or viewer  |
| `Enter`                | Open the focused artwork in the viewer           |
| `←` / `→`              | Move between pages and artworks in the viewer    |

## Permissions

- `storage`: Stores settings and metadata used by the archive.
- `scripting`: Retrieves information from artwork pages.
- `declarativeNetRequestWithHostAccess`: Adjusts requests when retrieving artwork images.
- `https://www.pixiv.net/*`: Retrieves artwork information.
- `https://i.pximg.net/*`: Retrieves artwork images.

The extension does not upload data to an external server or create sharing links. See the [privacy policy](PRIVACY.md) for details.

## Usage notice

Artwork copyrights belong to their respective rights holders. Keep recorded images within the scope of personal viewing, and do not repost, share, or redistribute them without permission. Review all applicable laws and the source service's terms, and use the extension at your own responsibility.

This is an unofficial extension and is not affiliated with Pixiv Inc.

## Feedback

Please report bugs and suggestions through [GitHub Issues](https://github.com/fjt-dev/illustration-archive/issues). Pull requests are welcome.
