import { ConfigService } from '@nestjs/config';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { promisify } from 'node:util';
import RssParser from 'rss-parser';

import config from '../../../../config';
import { TorrentsService } from '../../../torrents.service';
import { FeedType, type Feed } from '../../../../types';
import { TorrentInfoStatus } from '../../../db/entities/torrent.entity';

@Injectable()
export class ProwlarrTorrentSourceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProwlarrTorrentSourceService.name);
  private isTaskRunning: boolean;
  private feeds;

  constructor(
    private readonly torrentService: TorrentsService,
    private readonly configService: ConfigService,
  ) {
    this.feeds = this.configService.get<Array<Feed>>(
      'STREAMARRFS_PROWLARR_FEEDS',
    );
  }

  // Always run the job on startup after bit of delay
  async onApplicationBootstrap() {
    const delay = promisify(setTimeout);
    delay(5000).then(() => {
      this.runJob();
    });
  }

  @Cron(config().STREAMARRFS_PROWLARR_CRON_JOB_EXPRESSION, {
    name: ProwlarrTorrentSourceService.name,
  })
  async runJob() {
    if (
      this.configService.get<string>('STREAMARRFS_PROWLARR_FEED_DISABLED') ===
      'true'
    ) {
      this.logger.verbose(`aborting feed is disabled`);
      return;
    }

    if (this.isTaskRunning) {
      this.logger.verbose(`aborting an existing task running already`);
      return;
    }

    try {
      this.isTaskRunning = true;
      this.logger.log(`fetching torrents from feed`);
      for (const feed of this.feeds) {
        await this.processJsonFeed(feed);
      }
    } catch (err) {
      this.logger.error(`ERROR running feed cron`);
      this.logger.error(err);
    }

    this.isTaskRunning = false;
  }

  async processJsonFeed(feed: Feed) {
    try {
      const resp = await fetch(feed.url);

      if (resp.status === 200) {
        const jsonData = await resp.json();
        const torrents = jsonData || [];

        this.logger.log(
          `received ${torrents.length ?? 'no'} items from feed=${feed.name}`,
        );
        for (const torrent of torrents) {
          const torrentGuid = torrent?.guid || null;

          if (torrentGuid === null) {
            this.logger.warn(torrent, `torrent missing required fields`);
            continue;
          }
          const existingTorrent =
            await this.torrentService.findOneByFeedGuid(torrentGuid);
          if (!existingTorrent) {
            await this.torrentService.create({
              feedGuid: torrentGuid,
              feedURL: torrentGuid,
              status: TorrentInfoStatus.NEW,
              isVisible: false,
            });
          }
        }
      }

      if (resp.status !== 200) {
        this.logger.error(
          `Error processing feed=${feed.name} http status not 200`,
        );
      }
    } catch (err) {
      this.logger.error(`Error processing feed=${feed.name}`);
      this.logger.error(err);
    }
  }
}
