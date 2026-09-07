# Privacy Policy

Illustration Archive records metadata and images from pixiv artworks bookmarked by the user in a folder selected by the user.

[日本語](PRIVACY.ja.md)

## Information collected and recorded

- pixiv artwork ID, title, artist name, artist ID, tags, description, post date, source URL, original image URLs, and filenames
- Artwork images (only when **Include images** is enabled)
- Extension theme settings, acceptance of the usage notice, consent state for automatic and image recording, and the access handle for the archive folder

Artwork images are recorded in the selected folder only when **Include images** is enabled. Metadata needed to display the archive is stored in the browser. By default, artwork images are not retrieved, and metadata can be recorded without selecting an archive folder.

Metadata-only automatic recording uses information already embedded in pixiv artwork pages. It does not make additional requests or automatically retry to reconfirm bookmark status. Information needed to record images, and the images themselves, are retrieved from pixiv only when **Include images** is enabled.

## External transmission

This extension does not use a proprietary external server or analytics service. It does not send artwork information or images to third parties. Only when the user selects **Search with Google** is a search query containing the artwork ID, title, and artist name sent to Google.

## Permissions

- `storage`: Stores theme settings, archive-folder identifiers, and artwork metadata used by the archive.
- `scripting`: Connects automatic recording behavior to open pixiv artwork pages when the extension is updated.
- `declarativeNetRequestWithHostAccess`: Sets the Referer required to retrieve artwork images from pixiv's image server.
- `www.pixiv.net` / `i.pximg.net`: Retrieves artwork information and artwork images.

## Data deletion

Deleting an artwork from the archive removes its browser-stored archive data. To prevent accidental data loss, image files recorded in an external folder are not deleted automatically; users can delete those files with their file manager.
