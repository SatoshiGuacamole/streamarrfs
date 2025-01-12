import * as fs from 'fs/promises';
import { execSync } from 'child_process';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebTorrentService } from '../webtorrent/webtorrent.service';
import { TorrentsService } from '../torrents/torrents.service';
import { StreamarrFsService } from './streamarrfs.service';
import { TypeOrmSQLITETestingModule } from '../test-utils/TypeORMSQLITETestingModule';
import { useTorrentUtilProvider } from '../module-providers';
import { EventEmitterTestingModule } from '../test-utils/EventEmittterTestingModule';
import { torrentSingleFile } from './fixtures/torrent-single-file';
import { torrentMultipleFiles } from './fixtures/torrent-multiple-files';
import { torrentNotVisible } from './fixtures/torrent-not-visibile';

describe('StreamarrFsService', () => {
  let streamarrFsService: StreamarrFsService;
  let torrentService: TorrentsService;
  let configService: ConfigService;
  let mountPath: string;

  beforeAll(async () => {
    try {
      execSync(`fusermount -u -z ${mountPath}`);
      await fs.rm(mountPath, { recursive: true, force: true });
    } catch (err) {}
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ...TypeOrmSQLITETestingModule(),
        ...EventEmitterTestingModule(),
      ],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              // this is being super extra, in the case that you need multiple keys with the `get` method
              if (key === 'STREAMARRFS_MOUNT_PATH') {
                return '/tmp/streamarrfs-mnt';
              }
              return null;
            }),
          },
        },
        useTorrentUtilProvider(),
        TorrentsService,
        StreamarrFsService,
      ],
    })
      .useMocker((token) => {
        if (token === WebTorrentService) {
          return { torrents: jest.fn().mockResolvedValue([]) };
        }
      })
      .compile();
    torrentService = module.get<TorrentsService>(TorrentsService);
    streamarrFsService = module.get<StreamarrFsService>(StreamarrFsService);
    configService = module.get<ConfigService>(ConfigService);
    mountPath = configService.get<string>('STREAMARRFS_MOUNT_PATH');

    await streamarrFsService.onModuleInit();
  });

  it('when test started', async () => {
    expect(true).toBeDefined();
  });

  describe('when mounted', () => {
    it('should have a healthcheck directory', async () => {
      const rootDir = await fs.readdir(mountPath);
      expect(rootDir).toHaveLength(1);
      expect(rootDir).toContain('healthcheck');
    });
  });

  describe('when torrent(s) are added', () => {
    it('should have the torrent directory in mounted path', async () => {
      await torrentService.create(torrentSingleFile);
      const rootDir = await fs.readdir(mountPath);
      expect(rootDir).toHaveLength(2);
      expect(rootDir).toContain('healthcheck');
      expect(rootDir).toContain(torrentSingleFile.infoHash);
      await torrentService.removeByInfoHash(torrentSingleFile.infoHash);
    });

    it('should have multiples torrent directories in mounted path', async () => {
      await torrentService.create(torrentSingleFile);
      await torrentService.create(torrentMultipleFiles);
      const rootDir = await fs.readdir(mountPath);
      expect(rootDir).toHaveLength(3);
      expect(rootDir).toContain('healthcheck');
      expect(rootDir).toContain(torrentSingleFile.infoHash);
      expect(rootDir).toContain(torrentMultipleFiles.infoHash);
      await torrentService.removeByInfoHash(torrentSingleFile.infoHash);
      await torrentService.removeByInfoHash(torrentMultipleFiles.infoHash);
    });

    it('should not show non visibile torrents', async () => {
      await torrentService.create(torrentSingleFile);
      await torrentService.create(torrentNotVisible);
      const rootDir = await fs.readdir(mountPath);
      expect(rootDir).toHaveLength(2);
      expect(rootDir).toContain('healthcheck');
      expect(rootDir).toContain(torrentSingleFile.infoHash);
      await torrentService.removeByInfoHash(torrentSingleFile.infoHash);
      await torrentService.removeByInfoHash(torrentNotVisible.infoHash);
    });
  });

  describe('when torrentMultipleFiles is added', () => {
    beforeAll(async () => {
      await torrentService.create(torrentMultipleFiles);
    });
    afterAll(async () => {
      await torrentService.removeByInfoHash(torrentMultipleFiles.infoHash);
    });
    it('should have one dir', async () => {
      const torrentRoot = await fs.readdir(
        `${mountPath}/58ae7abc1d9e50d85f26dc376ef439b4a1fb5228`,
      );
      expect(torrentRoot).toHaveLength(1);
      expect(torrentRoot[0]).toEqual('dir');
    });

    it('should have 3 files in dir', async () => {
      const torrentDir = await fs.readdir(
        `${mountPath}/58ae7abc1d9e50d85f26dc376ef439b4a1fb5228/dir`,
      );
      expect(torrentDir).toHaveLength(3);
      expect(torrentDir).toEqual(['image.jpg', 'text.txt', 'video.mp4']);
    });

    it('should return correct length for video', async () => {
      const fileStat = await fs.stat(
        `${mountPath}/58ae7abc1d9e50d85f26dc376ef439b4a1fb5228/dir/video.mp4`,
      );
      expect(fileStat.size).toEqual(111111111);
    });
  });

  describe('when torrentSingleFile is added', () => {
    beforeAll(async () => {
      await torrentService.create(torrentSingleFile);
    });
    afterAll(async () => {
      await torrentService.removeByInfoHash(torrentSingleFile.infoHash);
    });
    it('should have one file only', async () => {
      const torrentRoot = await fs.readdir(
        `${mountPath}/1111111111111111111111111111111111111111`,
      );
      expect(torrentRoot).toHaveLength(1);
      expect(torrentRoot[0]).toEqual('singlefile.mp4');
    });
  });

  afterAll(async () => {
    await streamarrFsService._unmountFuseInstance();

    /**
     * TODO: Investigate why this behaves strangely.
     * When the FS is unmounted with just Fuse.unmount
     * unit-test will hang due to ungracefully teardown.
     */
    //await streamarrFsService.onApplicationShutdown();
  });
});
