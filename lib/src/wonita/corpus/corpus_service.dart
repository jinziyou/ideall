import 'package:dio/dio.dart';

import '../api_envelope.dart';
import '../api_paths.dart';
import '../json.dart';
import 'corpus_models.dart';

final class WonitaCorpusService {
  const WonitaCorpusService(this.dio);

  /// Public corpus endpoints do not require a Wonita session.
  final Dio dio;

  Future<WonitaPage<WonitaArticle>> query(WonitaArticleQuery query) async {
    final response = await dio.post<Object?>(
      WonitaApiPaths.articleQuery,
      data: query.toJson(),
    );
    return decodeWonitaPage(
      response,
      (value) => WonitaArticle.fromJson(jsonMap(value, context: 'article')),
    );
  }

  Future<WonitaArticle> get(String articleId) async {
    final response = await dio.get<Object?>(WonitaApiPaths.article(articleId));
    return decodeWonitaData(
      response,
      (value) => WonitaArticle.fromJson(jsonMap(value, context: 'article')),
    );
  }
}
